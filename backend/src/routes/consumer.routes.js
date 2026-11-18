import { Router } from 'express';
import { requireConsumer } from '../middleware/auth.js';
import { requireDevice } from '../middleware/device.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import * as v from '../validators/consumer.js';
import { consumption } from '../validators/device.js';

import * as auth from '../controllers/consumer/auth.controller.js';
import * as account from '../controllers/consumer/account.controller.js';
import * as recharges from '../controllers/consumer/recharges.controller.js';
import * as device from '../controllers/meter/device.controller.js';

const router = Router();

// ------------------------------------------------------------
// ESP32 meter (device key auth) - the only 2 APIs used by the .ino
// ------------------------------------------------------------

router.get('/meter/:meterId/balance', requireDevice, device.getDeviceBalance);
router.post('/meter/:meterId/consumption', requireDevice, validate({ body: consumption }), device.postConsumption);

// ------------------------------------------------------------
// Auth (public)
// ------------------------------------------------------------

router.post('/auth/login', loginLimiter, validate({ body: v.consumerLogin }), auth.login);

// Everything below requires a consumer token
router.use(requireConsumer);

// ------------------------------------------------------------
// Profile
// ------------------------------------------------------------

router.get('/profile', account.getProfile);
router.patch('/profile', validate({ body: v.updateProfile }), account.updateProfile);
router.patch('/password', validate({ body: v.changePassword }), account.changePassword);

// ------------------------------------------------------------
// Balance + usage
// ------------------------------------------------------------

router.get('/balance', account.getBalance);
router.get('/usage/summary', validate({ query: v.usageQuery }), account.getUsage);
router.get('/usage/readings', validate({ query: v.readingsQuery }), account.getReadings);

// ------------------------------------------------------------
// Recharges + transactions
// ------------------------------------------------------------

router.post('/recharges', validate({ body: v.createRecharge }), recharges.createRecharge);
router.get('/recharges', validate({ query: v.listRecharges }), recharges.listRecharges);
router.get('/transactions', validate({ query: v.listTransactions }), account.getTransactions);

export default router;
