import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import * as v from '../validators/admin.js';
import { idParams, meterParams } from '../validators/common.js';

import * as auth from '../controllers/admin/auth.controller.js';
import * as admins from '../controllers/admin/admins.controller.js';
import * as consumers from '../controllers/admin/consumers.controller.js';
import * as meters from '../controllers/admin/meters.controller.js';
import * as tariff from '../controllers/admin/tariff.controller.js';
import * as recharges from '../controllers/admin/recharges.controller.js';
import * as transactions from '../controllers/admin/transactions.controller.js';
import * as dashboard from '../controllers/admin/dashboard.controller.js';
import * as reports from '../controllers/admin/reports.controller.js';

const router = Router();

// ------------------------------------------------------------
// Auth (public)
// ------------------------------------------------------------

router.post('/auth/login', loginLimiter, validate({ body: v.adminLogin }), auth.login);

// Everything below requires an admin token
router.use(requireAdmin);

router.get('/auth/me', auth.me);
router.patch('/auth/password', validate({ body: v.changePassword }), auth.changePassword);

// ------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------

router.get('/dashboard', dashboard.getDashboard);

// ------------------------------------------------------------
// Reports (dashboard charts)
// ------------------------------------------------------------

router.get('/reports/daily', validate({ query: v.dailyReport }), reports.getDailyReport);
router.get('/reports/top-meters', validate({ query: v.topMeters }), reports.getTopMeters);

// ------------------------------------------------------------
// Admin users
// ------------------------------------------------------------

router.get('/admins', admins.listAdmins);
router.post('/admins', validate({ body: v.createAdmin }), admins.createAdmin);
router.patch('/admins/:id', validate({ params: idParams, body: v.updateAdmin }), admins.updateAdmin);
router.post('/admins/:id/reset-password', validate({ params: idParams, body: v.resetPassword }), admins.resetAdminPassword);

// ------------------------------------------------------------
// Consumers
// ------------------------------------------------------------

router.get('/consumers', validate({ query: v.listConsumers }), consumers.listConsumers);
router.post('/consumers', validate({ body: v.createConsumer }), consumers.createConsumer);
router.get('/consumers/:id', validate({ params: idParams }), consumers.getConsumer);
router.patch('/consumers/:id', validate({ params: idParams, body: v.updateConsumer }), consumers.updateConsumer);
router.patch('/consumers/:id/status', validate({ params: idParams, body: v.consumerStatus }), consumers.setConsumerStatus);
router.post('/consumers/:id/reset-password', validate({ params: idParams, body: v.resetPassword }), consumers.resetConsumerPassword);
router.delete('/consumers/:id', validate({ params: idParams }), consumers.deleteConsumer);

// ------------------------------------------------------------
// Meters
// ------------------------------------------------------------

router.get('/meters', validate({ query: v.listMeters }), meters.listMeters);
router.get('/meters/:meterId', validate({ params: meterParams }), meters.getMeter);
router.patch('/meters/:meterId/status', validate({ params: meterParams, body: v.meterStatus }), meters.setMeterStatus);
router.post('/meters/:meterId/regenerate-key', validate({ params: meterParams }), meters.regenerateDeviceKey);
router.get('/meters/:meterId/readings', validate({ params: meterParams, query: v.readingsQuery }), meters.getMeterReadings);
router.get('/meters/:meterId/usage', validate({ params: meterParams, query: v.usageQuery }), meters.getMeterUsage);
router.post('/meters/:meterId/adjust', validate({ params: meterParams, body: v.adjustBalance }), meters.adjustMeterBalance);

// ------------------------------------------------------------
// Tariff
// ------------------------------------------------------------

router.get('/tariff', tariff.showTariff);
router.put('/tariff', validate({ body: v.updateTariff }), tariff.updateTariff);

// ------------------------------------------------------------
// Recharges
// ------------------------------------------------------------

router.get('/recharges', validate({ query: v.listRecharges }), recharges.listRecharges);
router.post('/recharges', validate({ body: v.adminRecharge }), recharges.createRecharge);
router.patch('/recharges/:id/approve', validate({ params: idParams }), recharges.approveRecharge);
router.patch('/recharges/:id/reject', validate({ params: idParams, body: v.rejectRecharge }), recharges.rejectRecharge);

// ------------------------------------------------------------
// Transactions
// ------------------------------------------------------------

router.get('/transactions', validate({ query: v.listTransactions }), transactions.listTransactions);

export default router;
