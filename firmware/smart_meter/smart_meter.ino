/*
============================================================
 ESP32 PREPAID ENERGY + WATER SMART UTILITY METER
 DUAL CORE | SIM900A GPRS | PZEM-004T v3.0 | YF-S201
 Server-controlled: all billing is done by the backend
============================================================

 CORE 1 - MeterTask
   - PZEM-004T energy reading ........ every 1 s
   - YF-S201 water flow reading ...... every 1 s
   - Relay control (server decision)
   - LCD page rotation ............... every 3 s
   - Serial report ................... every 5 s
   - Water counter save .............. every 10 s

 CORE 0 - NetworkTask
   - SIM900A baud detection + init
   - GPRS bearer connection (mobile data)
   - GET  balance ..................... every 30 s
   - POST consumption ................. every 1 minute

 BACKEND APIs (only these 2 are used)
   GET  /consumer/meter/<METER_ID>/balance?key=<DEVICE_KEY>
   POST /consumer/meter/<METER_ID>/consumption?key=<DEVICE_KEY>

 RELAY RULE (default OFF)
   Supply is ON only when the last server reply said
   "relay":"on" AND that reply is newer than OFFLINE_TIMEOUT.
   At boot, or without server contact, the supply stays OFF.

 LIBRARIES
   PZEM004Tv30, LiquidCrystal, ArduinoJson (v7)
============================================================
*/

#include <HardwareSerial.h>
#include <PZEM004Tv30.h>
#include <LiquidCrystal.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <math.h>

// ============================================================
// METER IDENTITY + SERVER
// METER_ID and DEVICE_KEY are given by the admin panel when the
// consumer is created (POST /admin/consumers).
//
// SERVER_URL must be plain http:// - the SIM900A cannot do modern
// HTTPS. Use the Cloudflare Worker relay URL (cloudflare-worker/),
// which forwards to Render over HTTPS. Do NOT use the onrender.com URL.
// ============================================================

const char SERVER_URL[] = "http://flat-butterfly-aa1c.mdhassan49-muh.workers.dev";
const char METER_ID[] = "MTR-0001";
const char DEVICE_KEY[] = "587b87310f8037831afb8999e16ce285";

// ============================================================
// PIN CONFIGURATION
// ============================================================

// PZEM-004T (UART2)
#define PZEM_RX_PIN 16
#define PZEM_TX_PIN 17

// SIM900A (UART1)
#define SIM_RX_PIN 19
#define SIM_TX_PIN 21

// LCD 16x2 parallel
#define LCD_RS_PIN 32
#define LCD_EN_PIN 33
#define LCD_D4_PIN 14
#define LCD_D5_PIN 27
#define LCD_D6_PIN 4
#define LCD_D7_PIN 5

// YF-S201 water flow sensor
#define FLOW_SENSOR_PIN 2

// Relays
#define ENERGY_RELAY_PIN 26
#define WATER_RELAY_PIN 25
#define RELAY_ACTIVE_LOW true   // Most 5V relay modules are active-LOW

// YF-S201: pulse frequency (Hz) = 7.5 x flow rate (L/min)
const float FLOW_PULSES_PER_LPM = 7.5;

// ============================================================
// TIMING (ms)
// ============================================================

const unsigned long READ_INTERVAL = 1000;
const unsigned long DISPLAY_INTERVAL = 3000;
const unsigned long SERIAL_INTERVAL = 5000;
const unsigned long SAVE_INTERVAL = 10000;

const unsigned long BALANCE_INTERVAL = 30000;       // GET balance
const unsigned long CONSUMPTION_INTERVAL = 60000;   // POST consumption
const unsigned long OFFLINE_TIMEOUT = 300000;       // supply OFF after 5 min without server reply

const unsigned long NETWORK_WAIT_TIMEOUT = 60000;
const unsigned long BEARER_OPEN_TIMEOUT = 85000;
const unsigned long HTTP_ACTION_TIMEOUT = 60000;
const unsigned long HTTP_DATA_TIMEOUT = 10000;
const unsigned long HTTP_READ_TIMEOUT = 10000;

// ============================================================
// GPRS
// ============================================================

// Teletalk APN: must match the APN in your phone's
// Settings > Mobile network > Access Point Names
const char GPRS_APN[] = "internet";

// Public DNS used when the mobile network DNS fails (HTTP 603)
const char DNS_PRIMARY[] = "8.8.8.8";
const char DNS_SECONDARY[] = "1.1.1.1";

// true = print every AT command and modem reply in Serial Monitor
const bool SIM_DEBUG = true;

const int SIM_BAUD_RATES[] = {9600, 19200, 38400, 57600, 115200};
const int SIM_BAUD_COUNT = sizeof(SIM_BAUD_RATES) / sizeof(SIM_BAUD_RATES[0]);
const int SIM_RX_BUFFER_SIZE = 1024;

// ============================================================
// FREERTOS TASK SETTINGS
// ============================================================

const uint32_t TASK_STACK_SIZE = 10000;
const UBaseType_t TASK_PRIORITY = 1;
const uint8_t LCD_PAGE_COUNT = 5;

// ============================================================
// HARDWARE OBJECTS
// ============================================================

PZEM004Tv30 pzem(Serial2, PZEM_RX_PIN, PZEM_TX_PIN);
HardwareSerial sim900(1);
LiquidCrystal lcd(LCD_RS_PIN, LCD_EN_PIN, LCD_D4_PIN, LCD_D5_PIN, LCD_D6_PIN, LCD_D7_PIN);
Preferences preferences;

// ============================================================
// DATA TYPES
// ============================================================

enum HttpMethod {
  METHOD_GET = 0,
  METHOD_POST = 1
};

struct MeterData {
  float voltage;          // V
  float current;          // A
  float power;            // W
  float frequency;        // Hz
  float pf;
  float energyCounter;    // kWh (PZEM internal counter, sent to server)
  float flowRate;         // L/min
  double totalWater;      // L (device water counter, sent to server)
};

struct ServerState {
  bool synced;                  // at least one valid server reply received
  bool relayOn;                 // server decision
  float balance;                // Tk
  char state[20];               // active | no_balance | meter_disabled | consumer_suspended
  unsigned long lastSyncMillis;
};

struct NetworkData {
  char status[17];
  int lastGetCode;
  int lastPostCode;
  uint32_t postSuccessCount;
};

// ============================================================
// SHARED STATE (protected by dataMutex)
// ============================================================

TaskHandle_t Task0;
TaskHandle_t Task1;

SemaphoreHandle_t dataMutex;
SemaphoreHandle_t serialMutex;

MeterData meter = {NAN, NAN, NAN, NAN, NAN, NAN, 0.0, 0.0};
ServerState server = {false, false, 0.0, "waiting", 0};
NetworkData network = {"STARTING", 0, 0, 0};

// Core 1 only
volatile uint32_t pulseCount = 0;
portMUX_TYPE flowMux = portMUX_INITIALIZER_UNLOCKED;
double savedWater = 0.0;

// Core 0 only
bool modemReady = false;

// Forward declarations
void core0Task(void *pvParameters);
void core1Task(void *pvParameters);

// ============================================================
// SHARED DATA ACCESS
// ============================================================

MeterData getMeterData() {
  xSemaphoreTake(dataMutex, portMAX_DELAY);
  MeterData copy = meter;
  xSemaphoreGive(dataMutex);
  return copy;
}

ServerState getServerState() {
  xSemaphoreTake(dataMutex, portMAX_DELAY);
  ServerState copy = server;
  xSemaphoreGive(dataMutex);
  return copy;
}

NetworkData getNetworkData() {
  xSemaphoreTake(dataMutex, portMAX_DELAY);
  NetworkData copy = network;
  xSemaphoreGive(dataMutex);
  return copy;
}

void setNetworkStatus(const char *status) {
  xSemaphoreTake(dataMutex, portMAX_DELAY);
  strncpy(network.status, status, sizeof(network.status) - 1);
  network.status[sizeof(network.status) - 1] = '\0';
  xSemaphoreGive(dataMutex);
}

void setHttpResult(HttpMethod method, int statusCode) {
  xSemaphoreTake(dataMutex, portMAX_DELAY);

  if (method == METHOD_GET) {
    network.lastGetCode = statusCode;
  }
  else {
    network.lastPostCode = statusCode;

    if (statusCode == 200) {
      network.postSuccessCount++;
    }
  }

  xSemaphoreGive(dataMutex);
}

bool isHttpResponse(int statusCode) {
  // 600+ codes are SIM900A internal network errors, not server replies
  return statusCode >= 100 && statusCode < 600;
}

// ============================================================
// SERIAL LOGGING (thread-safe across both cores)
// ============================================================

void serialLock() {
  xSemaphoreTake(serialMutex, portMAX_DELAY);
}

void serialUnlock() {
  xSemaphoreGive(serialMutex);
}

void logMessage(const char *tag, const String &message) {
  serialLock();
  Serial.print("[");
  Serial.print(tag);
  Serial.print("] ");
  Serial.println(message);
  serialUnlock();
}

// Meaning of HTTP status codes as reported by the SIM900A
const char *statusMeaning(int statusCode) {
  switch (statusCode) {
    case 200: return "OK";
    case 301:
    case 302:
    case 307:
    case 308: return "REDIRECT TO HTTPS - use the http:// Worker URL";
    case 401: return "WRONG METER_ID OR DEVICE_KEY";
    case 404: return "WRONG URL / ROUTE";
    case 422: return "INVALID DATA SENT";
    case 429: return "TOO MANY REQUESTS";
    case 500: return "SERVER ERROR";
    case 502:
    case 503: return "BACKEND DOWN OR WAKING UP";
    case 601: return "SIM900A NETWORK ERROR - check data balance / APN";
    case 602: return "SIM900A OUT OF MEMORY";
    case 603: return "SIM900A DNS ERROR - host name not resolved";
    case 604: return "SIM900A STACK BUSY";
    default:  return "";
  }
}

void printStatusCode(int statusCode) {
  if (statusCode == 0) {
    Serial.println("NOT SENT");
  }
  else if (statusCode < 0) {
    Serial.println("NO RESPONSE (modem error)");
  }
  else {
    Serial.print(statusCode);
    Serial.print(" ");
    Serial.println(statusMeaning(statusCode));
  }
}

// ============================================================
// SUPPLY DECISION (default OFF)
// ============================================================

bool isServerFresh(const ServerState &state) {
  return state.synced && (millis() - state.lastSyncMillis < OFFLINE_TIMEOUT);
}

bool shouldSupplyBeOn(const ServerState &state) {
  return isServerFresh(state) && state.relayOn;
}

const char *supplyReason(const ServerState &state) {
  if (!state.synced) return "WAITING SERVER";
  if (!isServerFresh(state)) return "SERVER OFFLINE";
  if (state.relayOn) return "SUPPLY ON";
  if (strcmp(state.state, "no_balance") == 0) return "BALANCE ZERO";
  if (strcmp(state.state, "meter_disabled") == 0) return "METER DISABLED";
  if (strcmp(state.state, "consumer_suspended") == 0) return "SUSPENDED";
  return "SUPPLY OFF";
}

// ============================================================
// RELAY CONTROL
// ============================================================

void setRelay(int pin, bool supplyOn) {
  if (RELAY_ACTIVE_LOW) {
    digitalWrite(pin, supplyOn ? LOW : HIGH);
  }
  else {
    digitalWrite(pin, supplyOn ? HIGH : LOW);
  }
}

void setSupply(bool supplyOn) {
  setRelay(ENERGY_RELAY_PIN, supplyOn);
  setRelay(WATER_RELAY_PIN, supplyOn);
}

void initializeRelays() {
  // Preload the OFF level before enabling outputs to avoid a relay pulse at boot
  digitalWrite(ENERGY_RELAY_PIN, RELAY_ACTIVE_LOW ? HIGH : LOW);
  digitalWrite(WATER_RELAY_PIN, RELAY_ACTIVE_LOW ? HIGH : LOW);

  pinMode(ENERGY_RELAY_PIN, OUTPUT);
  pinMode(WATER_RELAY_PIN, OUTPUT);

  setSupply(false);
}

void updateSupply() {
  static int lastSupplyState = -1;

  ServerState state = getServerState();
  bool supplyOn = shouldSupplyBeOn(state);

  setSupply(supplyOn);

  if ((int)supplyOn != lastSupplyState) {
    lastSupplyState = supplyOn;
    logMessage("METER", String("ENERGY + WATER SUPPLY ") + (supplyOn ? "ON" : "OFF") + " - " + supplyReason(state));
  }
}

// ============================================================
// PREFERENCES STORAGE (water counter only)
// ============================================================

void loadMeterData() {
  preferences.begin("meter", false);

  meter.totalWater = preferences.getDouble("water_l", 0.0);
  savedWater = meter.totalWater;
}

void saveWaterCounter() {
  double totalWater = getMeterData().totalWater;

  // Write only when changed to reduce flash wear
  if (totalWater != savedWater) {
    preferences.putDouble("water_l", totalWater);
    savedWater = totalWater;
  }
}

// ============================================================
// WATER FLOW SENSOR
// ============================================================

void IRAM_ATTR flowInterrupt() {
  portENTER_CRITICAL_ISR(&flowMux);
  pulseCount++;
  portEXIT_CRITICAL_ISR(&flowMux);
}

void initializeFlowSensor() {
  pinMode(FLOW_SENSOR_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(FLOW_SENSOR_PIN), flowInterrupt, RISING);
}

// Returns liters used in this interval; flowRate is set in L/min
float readWaterSensor(float &flowRate) {
  portENTER_CRITICAL(&flowMux);
  uint32_t pulses = pulseCount;
  pulseCount = 0;
  portEXIT_CRITICAL(&flowMux);

  float intervalSeconds = READ_INTERVAL / 1000.0;

  flowRate = (pulses / intervalSeconds) / FLOW_PULSES_PER_LPM;

  return flowRate * (intervalSeconds / 60.0);
}

// ============================================================
// SENSOR CYCLE
// ============================================================

void runMeterCycle() {
  float flowRate = 0.0;
  float litersUsed = readWaterSensor(flowRate);

  float voltage = pzem.voltage();
  float current = pzem.current();
  float power = pzem.power();
  float energy = pzem.energy();
  float frequency = pzem.frequency();
  float pf = pzem.pf();

  xSemaphoreTake(dataMutex, portMAX_DELAY);

  meter.voltage = voltage;
  meter.current = current;
  meter.power = power;
  meter.energyCounter = energy;
  meter.frequency = frequency;
  meter.pf = pf;

  meter.flowRate = flowRate;
  meter.totalWater += litersUsed;

  xSemaphoreGive(dataMutex);

  updateSupply();
}

// ============================================================
// LCD DISPLAY
// ============================================================

void lcdPrintLine(uint8_t row, const char *text) {
  char line[17];
  snprintf(line, sizeof(line), "%-16s", text);

  lcd.setCursor(0, row);
  lcd.print(line);
}

void initializeLCD() {
  lcd.begin(16, 2);
  lcd.clear();

  lcdPrintLine(0, "SMART PREPAID");
  lcdPrintLine(1, METER_ID);
}

void formatStatusCode(char *buffer, size_t size, int statusCode) {
  if (statusCode == 0) {
    snprintf(buffer, size, "--");
  }
  else {
    snprintf(buffer, size, "%d", statusCode);
  }
}

void updateLCD(uint8_t page) {
  MeterData data = getMeterData();
  ServerState state = getServerState();
  NetworkData net = getNetworkData();

  char top[17];
  char bottom[17];

  switch (page) {

    case 0:
      snprintf(top, sizeof(top), "Bal:%.2f Tk", state.balance);
      snprintf(bottom, sizeof(bottom), "%s", supplyReason(state));
      break;

    case 1:
      if (isnan(data.voltage)) {
        snprintf(top, sizeof(top), "PZEM ERROR");
        snprintf(bottom, sizeof(bottom), "Check wiring");
      }
      else {
        snprintf(top, sizeof(top), "%.1fV %.2fA", data.voltage, data.current);
        snprintf(bottom, sizeof(bottom), "Power:%.1fW", data.power);
      }
      break;

    case 2:
      snprintf(top, sizeof(top), "Energy:%.3fkWh", isnan(data.energyCounter) ? 0.0 : data.energyCounter);
      snprintf(bottom, sizeof(bottom), "Water:%.1f L", data.totalWater);
      break;

    case 3: {
      char getCode[6];
      char postCode[6];

      formatStatusCode(getCode, sizeof(getCode), net.lastGetCode);
      formatStatusCode(postCode, sizeof(postCode), net.lastPostCode);

      snprintf(top, sizeof(top), "NET:%s", net.status);
      snprintf(bottom, sizeof(bottom), "GET:%s POST:%s", getCode, postCode);
      break;
    }

    default:
      snprintf(top, sizeof(top), "%s", METER_ID);
      snprintf(bottom, sizeof(bottom), "Flow:%.2f L/m", data.flowRate);
      break;
  }

  lcdPrintLine(0, top);
  lcdPrintLine(1, bottom);
}

// ============================================================
// SERIAL REPORT
// ============================================================

void printStartupInfo() {
  serialLock();

  Serial.println("\n======================================");
  Serial.println(" ESP32 PREPAID SMART UTILITY METER");
  Serial.println(" DUAL CORE | SIM900A GPRS | SERVER");
  Serial.println("======================================");

  Serial.print("Meter ID: ");
  Serial.println(METER_ID);

  Serial.print("Server: ");
  Serial.println(SERVER_URL);

  Serial.print("GPRS APN: ");
  Serial.println(GPRS_APN);

  Serial.print("Relay Logic: ");
  Serial.println(RELAY_ACTIVE_LOW ? "ACTIVE LOW" : "ACTIVE HIGH");

  Serial.print("Saved Water Counter: ");
  Serial.print(getMeterData().totalWater, 3);
  Serial.println(" L");

  Serial.println("Supply is OFF until the server allows it.");
  Serial.println("GET balance every 30 s, POST consumption every 1 min.");

  if (strncmp(SERVER_URL, "https://", 8) == 0) {
    Serial.println("\n!!! SERVER_URL uses https:// !!!");
    Serial.println("The SIM900A cannot connect to HTTPS servers.");
    Serial.println("Use the http:// Cloudflare Worker URL instead.");
  }

  Serial.println("======================================");

  serialUnlock();
}

void printSerialReport() {
  MeterData data = getMeterData();
  ServerState state = getServerState();
  NetworkData net = getNetworkData();

  bool supplyOn = shouldSupplyBeOn(state);

  serialLock();

  Serial.println("\n======================================");
  Serial.println("       PREPAID SMART METER");
  Serial.println("======================================");

  Serial.println("---------- ENERGY ----------");

  if (isnan(data.voltage)) {
    Serial.println("PZEM ERROR");
  }
  else {
    Serial.print("Voltage: ");
    Serial.print(data.voltage, 2);
    Serial.println(" V");

    Serial.print("Current: ");
    Serial.print(data.current, 3);
    Serial.println(" A");

    Serial.print("Power: ");
    Serial.print(data.power, 2);
    Serial.println(" W");

    Serial.print("Energy Counter: ");
    Serial.print(data.energyCounter, 3);
    Serial.println(" kWh");

    Serial.print("Frequency: ");
    Serial.print(data.frequency, 2);
    Serial.println(" Hz");

    Serial.print("Power Factor: ");
    Serial.println(data.pf, 2);
  }

  Serial.println("\n---------- WATER ----------");

  Serial.print("Flow Rate: ");
  Serial.print(data.flowRate, 2);
  Serial.println(" L/min");

  Serial.print("Water Counter: ");
  Serial.print(data.totalWater, 3);
  Serial.println(" L");

  Serial.println("\n---------- SERVER ----------");

  Serial.print("Network Status: ");
  Serial.println(net.status);

  Serial.print("Balance: ");
  Serial.print(state.balance, 2);
  Serial.println(" Tk");

  Serial.print("Server State: ");
  Serial.println(state.state);

  Serial.print("Last Server Reply: ");
  if (state.synced) {
    Serial.print((millis() - state.lastSyncMillis) / 1000);
    Serial.println(" s ago");
  }
  else {
    Serial.println("never");
  }

  Serial.print("Last GET Status: ");
  printStatusCode(net.lastGetCode);

  Serial.print("Last POST Status: ");
  printStatusCode(net.lastPostCode);

  Serial.print("Successful POSTs: ");
  Serial.println(net.postSuccessCount);

  Serial.println("\n---------- SUPPLY ----------");

  const char *onLevel = RELAY_ACTIVE_LOW ? "LOW (ON)" : "HIGH (ON)";
  const char *offLevel = RELAY_ACTIVE_LOW ? "HIGH (OFF)" : "LOW (OFF)";

  Serial.print("Energy Relay GPIO26: ");
  Serial.println(supplyOn ? onLevel : offLevel);

  Serial.print("Water Relay GPIO25: ");
  Serial.println(supplyOn ? onLevel : offLevel);

  Serial.print("Supply: ");
  Serial.println(supplyReason(state));

  Serial.println("======================================");

  serialUnlock();
}

void printHttpResult(const char *method, const char *path, const String &payload, int statusCode, const String &responseBody) {
  serialLock();

  Serial.println("\n---------- HTTP ----------");

  Serial.print("Request: ");
  Serial.print(method);
  Serial.print(" ");
  Serial.println(path);

  if (payload.length() > 0) {
    Serial.print("Payload: ");
    Serial.println(payload);
  }

  Serial.print("HTTP Status: ");
  printStatusCode(statusCode);

  if (responseBody.length() > 0) {
    Serial.print("Response: ");
    Serial.println(responseBody);
  }

  Serial.println("--------------------------");

  serialUnlock();
}

// ============================================================
// SIM900A AT COMMAND HELPERS (Core 0)
// ============================================================

void simFlush() {
  while (sim900.available()) {
    sim900.read();
  }
}

// Waits until the line containing `expected` is complete, or ERROR / timeout
bool simWaitFor(const char *expected, unsigned long timeout, String *response) {
  String buffer = "";
  unsigned long start = millis();

  while (millis() - start < timeout) {

    while (sim900.available()) {
      buffer += (char)sim900.read();
    }

    int pos = buffer.indexOf(expected);

    if (pos >= 0 && buffer.indexOf('\n', pos) >= 0) {
      if (response != nullptr) *response = buffer;
      return true;
    }

    if (buffer.indexOf("ERROR") >= 0 && buffer.endsWith("\n")) {
      break;
    }

    vTaskDelay(pdMS_TO_TICKS(10));
  }

  if (response != nullptr) *response = buffer;
  return false;
}

// Modem reply on one line for the debug log
String compactResponse(const String &response) {
  String text = response;

  text.replace("\r", "");
  text.trim();
  text.replace("\n\n", "\n");
  text.replace("\n", " | ");

  return text.length() > 0 ? text : "(no reply)";
}

bool simCommand(const char *command, const char *expected, unsigned long timeout, String *response) {
  String reply;

  simFlush();
  sim900.println(command);

  bool success = simWaitFor(expected, timeout, &reply);

  if (SIM_DEBUG) {
    logMessage("AT", String(command) + "  ->  " + compactResponse(reply));
  }

  if (response != nullptr) *response = reply;
  return success;
}

// ============================================================
// SIM900A INITIALIZATION (Core 0)
// ============================================================

bool testSimBaud(int baud) {
  sim900.end();
  sim900.setRxBufferSize(SIM_RX_BUFFER_SIZE);
  sim900.begin(baud, SERIAL_8N1, SIM_RX_PIN, SIM_TX_PIN);

  vTaskDelay(pdMS_TO_TICKS(500));

  for (int attempt = 0; attempt < 3; attempt++) {
    if (simCommand("AT", "OK", 1200, nullptr)) {
      return true;
    }
  }

  return false;
}

int detectSimBaud() {
  for (int i = 0; i < SIM_BAUD_COUNT; i++) {

    logMessage("SIM", "Testing baud: " + String(SIM_BAUD_RATES[i]));

    if (testSimBaud(SIM_BAUD_RATES[i])) {
      return SIM_BAUD_RATES[i];
    }
  }

  return 0;
}

bool initializeModem() {
  setNetworkStatus("MODEM INIT");
  logMessage("SIM", "Initializing SIM900A");

  int baud = detectSimBaud();

  if (baud == 0) {
    setNetworkStatus("MODEM ERROR");
    logMessage("SIM", "SIM900A not found");
    return false;
  }

  logMessage("SIM", "Working baud: " + String(baud));

  simCommand("ATE0", "OK", 1000, nullptr);
  simCommand("AT+CMEE=2", "OK", 1000, nullptr);

  if (!simCommand("AT+CPIN?", "READY", 5000, nullptr)) {
    setNetworkStatus("SIM ERROR");
    logMessage("SIM", "SIM card not ready");
    return false;
  }

  logMessage("SIM", "SIM900A ready");
  return true;
}

// ============================================================
// GPRS CONNECTION (Core 0)
// ============================================================

bool isNetworkRegistered() {
  String response;

  if (!simCommand("AT+CREG?", "OK", 3000, &response)) return false;

  int pos = response.indexOf("+CREG:");
  if (pos < 0) return false;

  int comma = response.indexOf(',', pos);
  if (comma < 0) return false;

  int status = response.substring(comma + 1).toInt();

  // 1 = registered home, 5 = registered roaming
  return status == 1 || status == 5;
}

bool waitForNetwork() {
  unsigned long start = millis();

  while (millis() - start < NETWORK_WAIT_TIMEOUT) {

    if (isNetworkRegistered()) return true;

    vTaskDelay(pdMS_TO_TICKS(2000));
  }

  return false;
}

bool isBearerOpen(String *ipAddress) {
  String response;

  if (!simCommand("AT+SAPBR=2,1", "OK", 3000, &response)) return false;

  // Response: +SAPBR: 1,<status>,"<ip>"   status 1 = connected
  int pos = response.indexOf("+SAPBR:");
  if (pos < 0) return false;

  int comma = response.indexOf(',', pos);
  if (comma < 0) return false;

  if (response.substring(comma + 1).toInt() != 1) return false;

  if (ipAddress != nullptr) {
    int quoteStart = response.indexOf('"', comma);
    int quoteEnd = response.indexOf('"', quoteStart + 1);

    *ipAddress = (quoteStart >= 0 && quoteEnd > quoteStart)
                 ? response.substring(quoteStart + 1, quoteEnd)
                 : "";
  }

  return true;
}

bool connectGPRS() {
  setNetworkStatus("CONNECTING");

  if (!waitForNetwork()) {
    setNetworkStatus("NO NETWORK");
    logMessage("GPRS", "Network not registered");
    return false;
  }

  if (!simCommand("AT+CGATT?", "+CGATT: 1", 3000, nullptr) &&
      !simCommand("AT+CGATT=1", "OK", 10000, nullptr)) {
    setNetworkStatus("GPRS FAILED");
    logMessage("GPRS", "GPRS attach failed");
    return false;
  }

  char apnCommand[64];
  snprintf(apnCommand, sizeof(apnCommand), "AT+SAPBR=3,1,\"APN\",\"%s\"", GPRS_APN);

  simCommand("AT+SAPBR=3,1,\"CONTYPE\",\"GPRS\"", "OK", 2000, nullptr);
  simCommand(apnCommand, "OK", 2000, nullptr);

  logMessage("GPRS", String("Opening bearer, APN: ") + GPRS_APN);

  String ipAddress;

  if (!simCommand("AT+SAPBR=1,1", "OK", BEARER_OPEN_TIMEOUT, nullptr) ||
      !isBearerOpen(&ipAddress)) {
    setNetworkStatus("GPRS FAILED");
    logMessage("GPRS", "Bearer open failed - check APN and mobile data balance");
    return false;
  }

  // Fallback DNS servers in case the network DNS fails (603).
  // An ERROR reply here is harmless.
  char dnsCommand[64];
  snprintf(dnsCommand, sizeof(dnsCommand), "AT+CDNSCFG=\"%s\",\"%s\"", DNS_PRIMARY, DNS_SECONDARY);
  simCommand(dnsCommand, "OK", 2000, nullptr);

  setNetworkStatus("ONLINE");
  logMessage("GPRS", "Connected, IP: " + ipAddress);
  return true;
}

bool ensureOnline() {
  if (!modemReady) {
    modemReady = initializeModem();
    if (!modemReady) return false;
  }

  if (!simCommand("AT", "OK", 1000, nullptr)) {
    modemReady = false;
    setNetworkStatus("MODEM ERROR");
    logMessage("SIM", "SIM900A not responding");
    return false;
  }

  if (isBearerOpen(nullptr)) return true;

  return connectGPRS();
}

// ============================================================
// HTTP CLIENT (Core 0)
// ============================================================

bool httpReadResponse(String &body) {
  simFlush();
  sim900.println("AT+HTTPREAD");

  String buffer = "";
  int dataStart = -1;
  int dataLength = 0;
  unsigned long start = millis();

  while (millis() - start < HTTP_READ_TIMEOUT) {

    while (sim900.available()) {
      buffer += (char)sim900.read();
    }

    // Header: +HTTPREAD: <length>
    if (dataStart < 0) {
      int header = buffer.indexOf("+HTTPREAD:");

      if (header >= 0) {
        int lineEnd = buffer.indexOf('\n', header);

        if (lineEnd >= 0) {
          dataLength = buffer.substring(header + 10, lineEnd).toInt();
          dataStart = lineEnd + 1;
        }
      }
      else if (buffer.indexOf("ERROR") >= 0) {
        return false;
      }
    }

    if (dataStart >= 0 &&
        (int)buffer.length() >= dataStart + dataLength &&
        buffer.indexOf("OK", dataStart + dataLength) >= 0) {

      body = buffer.substring(dataStart, dataStart + dataLength);
      return true;
    }

    vTaskDelay(pdMS_TO_TICKS(10));
  }

  return false;
}

// Returns HTTP status code, or -1 on modem error
int httpRequest(HttpMethod method, const char *url, const String &payload, String &responseBody) {
  char command[256];
  String response;
  int statusCode = -1;

  responseBody = "";

  // Close any session left open by a previous failed request (ERROR here is normal)
  simCommand("AT+HTTPTERM", "OK", 1000, nullptr);

  if (!simCommand("AT+HTTPINIT", "OK", 2000, nullptr)) return -1;

  bool ready = simCommand("AT+HTTPPARA=\"CID\",1", "OK", 2000, nullptr);

  snprintf(command, sizeof(command), "AT+HTTPPARA=\"URL\",\"%s\"", url);
  ready = ready && simCommand(command, "OK", 2000, nullptr);

  if (ready && method == METHOD_POST) {

    ready = simCommand("AT+HTTPPARA=\"CONTENT\",\"application/json\"", "OK", 2000, nullptr);

    snprintf(command, sizeof(command), "AT+HTTPDATA=%u,%lu", payload.length(), HTTP_DATA_TIMEOUT);
    ready = ready && simCommand(command, "DOWNLOAD", 3000, nullptr);

    if (ready) {
      sim900.print(payload);
      ready = simWaitFor("OK", HTTP_DATA_TIMEOUT + 1000, nullptr);
    }
  }

  if (ready) {
    snprintf(command, sizeof(command), "AT+HTTPACTION=%d", (int)method);

    // Response: OK, then +HTTPACTION: <method>,<status>,<length>
    if (simCommand(command, "+HTTPACTION:", HTTP_ACTION_TIMEOUT, &response)) {

      int pos = response.indexOf("+HTTPACTION:");
      int firstComma = response.indexOf(',', pos);
      int secondComma = response.indexOf(',', firstComma + 1);

      if (firstComma > 0 && secondComma > firstComma) {
        statusCode = response.substring(firstComma + 1, secondComma).toInt();

        int contentLength = response.substring(secondComma + 1).toInt();

        if (contentLength > 0) {
          httpReadResponse(responseBody);
        }
      }
    }
  }

  simCommand("AT+HTTPTERM", "OK", 1000, nullptr);

  return statusCode;
}

// ============================================================
// BACKEND API (Core 0)
// ============================================================

// /consumer/meter/<METER_ID>/<endpoint>
void buildApiPath(char *buffer, size_t size, const char *endpoint) {
  snprintf(buffer, size, "/consumer/meter/%s/%s", METER_ID, endpoint);
}

// <SERVER_URL><path>?key=<DEVICE_KEY>
void buildApiUrl(char *buffer, size_t size, const char *path) {
  snprintf(buffer, size, "%s%s?key=%s", SERVER_URL, path, DEVICE_KEY);
}

// Server reply: {"meter_id":"MTR-0001","relay":"on","state":"active","balance":120.5,...}
bool applyServerReply(const String &body) {
  JsonDocument doc;

  if (deserializeJson(doc, body)) {
    logMessage("API", "Invalid JSON from server");
    return false;
  }

  const char *relay = doc["relay"];
  const char *state = doc["state"];

  if (relay == nullptr || state == nullptr) {
    logMessage("API", "Server reply missing relay/state");
    return false;
  }

  xSemaphoreTake(dataMutex, portMAX_DELAY);

  server.synced = true;
  server.relayOn = strcmp(relay, "on") == 0;
  server.balance = doc["balance"] | 0.0f;
  server.lastSyncMillis = millis();
  strncpy(server.state, state, sizeof(server.state) - 1);
  server.state[sizeof(server.state) - 1] = '\0';

  xSemaphoreGive(dataMutex);

  return true;
}

String jsonNumber(float value, int decimals) {
  if (isnan(value)) return "null";
  return String(value, decimals);
}

String buildConsumptionPayload(const MeterData &data) {
  String json = "{";

  json += "\"voltage\":" + jsonNumber(data.voltage, 2) + ",";
  json += "\"current\":" + jsonNumber(data.current, 3) + ",";
  json += "\"power\":" + jsonNumber(data.power, 2) + ",";
  json += "\"frequency\":" + jsonNumber(data.frequency, 2) + ",";
  json += "\"pf\":" + jsonNumber(data.pf, 2) + ",";
  json += "\"flow_rate\":" + jsonNumber(data.flowRate, 3) + ",";
  json += "\"energy_kwh\":" + jsonNumber(data.energyCounter, 3) + ",";
  json += "\"water_l\":" + String(data.totalWater, 3);

  json += "}";

  return json;
}

void sendRequest(HttpMethod method, const char *endpoint, const String &payload) {
  char path[96];
  char url[224];
  String responseBody;

  buildApiPath(path, sizeof(path), endpoint);
  buildApiUrl(url, sizeof(url), path);

  setNetworkStatus(method == METHOD_GET ? "SENDING GET" : "SENDING POST");

  int statusCode = httpRequest(method, url, payload, responseBody);

  setHttpResult(method, statusCode);
  setNetworkStatus(isHttpResponse(statusCode) ? "ONLINE" : "HTTP ERROR");

  printHttpResult(method == METHOD_GET ? "GET" : "POST", path, payload, statusCode, responseBody);

  if (statusCode == 200) {
    applyServerReply(responseBody);
  }
}

// GET /consumer/meter/<METER_ID>/balance
void requestBalance() {
  sendRequest(METHOD_GET, "balance", "");
}

// POST /consumer/meter/<METER_ID>/consumption
void sendConsumption() {
  sendRequest(METHOD_POST, "consumption", buildConsumptionPayload(getMeterData()));
}

// ============================================================
// CORE 0 TASK: NETWORK (SIM900A GPRS + BACKEND API)
// ============================================================

void core0Task(void *pvParameters) {
  bool firstRun = true;
  unsigned long lastBalanceMillis = 0;
  unsigned long lastConsumptionMillis = millis();

  for (;;) {

    // POST consumption every 1 minute (the reply also carries the balance)
    if (millis() - lastConsumptionMillis >= CONSUMPTION_INTERVAL) {

      lastConsumptionMillis = millis();

      if (ensureOnline()) {
        sendConsumption();
        lastBalanceMillis = millis();
      }
      else {
        logMessage("API", "Offline - consumption not sent");
      }
    }

    // GET balance at boot, then every 30 s
    if (firstRun || millis() - lastBalanceMillis >= BALANCE_INTERVAL) {

      firstRun = false;
      lastBalanceMillis = millis();

      if (ensureOnline()) {
        requestBalance();
      }
      else {
        logMessage("API", "Offline - balance check skipped");
      }
    }

    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

// ============================================================
// CORE 1 TASK: METER (SENSORS + RELAY + LCD + SERIAL)
// ============================================================

void core1Task(void *pvParameters) {
  unsigned long lastReadMillis = millis();
  unsigned long lastDisplayMillis = millis();
  unsigned long lastReportMillis = millis();
  unsigned long lastSaveMillis = millis();

  uint8_t displayPage = 0;

  for (;;) {
    unsigned long now = millis();

    if (now - lastReadMillis >= READ_INTERVAL) {
      lastReadMillis = now;
      runMeterCycle();
    }

    if (now - lastReportMillis >= SERIAL_INTERVAL) {
      lastReportMillis = now;
      printSerialReport();
    }

    if (now - lastSaveMillis >= SAVE_INTERVAL) {
      lastSaveMillis = now;
      saveWaterCounter();
    }

    if (now - lastDisplayMillis >= DISPLAY_INTERVAL) {
      lastDisplayMillis = now;
      updateLCD(displayPage);
      displayPage = (displayPage + 1) % LCD_PAGE_COUNT;
    }

    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

// ============================================================
// SETUP
// ============================================================

void setup() {
  Serial.begin(115200);
  delay(1500);

  dataMutex = xSemaphoreCreateMutex();
  serialMutex = xSemaphoreCreateMutex();

  initializeRelays();
  loadMeterData();
  initializeLCD();
  initializeFlowSensor();

  printStartupInfo();

  xTaskCreatePinnedToCore(
    core0Task,          // Task function
    "NetworkTask",      // Name of task
    TASK_STACK_SIZE,    // Stack size
    NULL,               // Parameter
    TASK_PRIORITY,      // Priority
    &Task0,             // Task handle
    0                   // Core 0
  );

  xTaskCreatePinnedToCore(
    core1Task,          // Task function
    "MeterTask",        // Name of task
    TASK_STACK_SIZE,    // Stack size
    NULL,               // Parameter
    TASK_PRIORITY,      // Priority
    &Task1,             // Task handle
    1                   // Core 1
  );
}

// ============================================================
// LOOP
// ============================================================

void loop() {
  // Both cores are handled by FreeRTOS tasks
  vTaskDelete(NULL);
}
