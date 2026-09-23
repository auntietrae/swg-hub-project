const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const serverless = require('serverless-http'); // <-- Added for Netlify compatibility

// Initialize Express app
const app = express();

// Enable CORS and JSON body parsing
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Connect to Supabase PostgreSQL database using environment variables
// Note: In Netlify, you will set these in the Netlify Dashboard (Site Settings > Environment Variables)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://your-supabase-instance.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'your-service-role-key';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const FOUNDER_HOTLINE = '+237676508320';

/**
 * Endpoint: POST /api/auth/send-otp
 */
app.post('/api/auth/send-otp', async (req, res) => {
    try {
        const { phone_number } = req.body;
        if (!phone_number || phone_number.length < 9) {
            return res.status(400).json({ success: false, error: 'Invalid phone number provided.' });
        }

        const otpCode = Math.floor(1000 + Math.random() * 9000).toString();
        
        const { error: dbError } = await supabase
            .from('otps')
            .upsert({ phone_number, code: otpCode, expires_at: new Date(Date.now() + 10 * 60000) });

        if (dbError) throw dbError;

        console.log(`[AUTH] Sent OTP ${otpCode} to +237 ${phone_number}`);
        return res.status(200).json({ success: true, message: 'OTP sent successfully.' });
    } catch (err) {
        console.error('[AUTH ERROR]', err);
        return res.status(500).json({ success: false, error: 'Internal server error during OTP dispatch.' });
    }
});

/**
 * Endpoint: POST /api/orders/create
 */
app.post('/api/orders/create', async (req, res) => {
    try {
        const { customer_phone, service_type, address, cylinder_photo_url, payment_status } = req.body;

        if (!customer_phone || !service_type || !address) {
            return res.status(400).json({ success: false, error: 'Missing required order fields.' });
        }

        const { data, error: insertError } = await supabase
            .from('orders')
            .insert([
                {
                    customer_phone,
                    service_type,
                    address,
                    cylinder_photo_url: cylinder_photo_url || null,
                    payment_status: payment_status || 'pending',
                    order_status: 'received'
                }
            ])
            .select();

        if (insertError) throw insertError;

        const newOrder = data[0];
        console.log(`[ORDER] New order created (#${newOrder.id}) for ${service_type} at ${address}`);

        return res.status(201).json({
            success: true,
            message: 'Order created successfully.',
            order_id: newOrder.id
        });
    } catch (err) {
        console.error('[ORDER ERROR]', err);
        return res.status(500).json({ success: false, error: 'Failed to create order.' });
    }
});

/**
 * Endpoint: POST /api/agents/withdraw
 */
app.post('/api/agents/withdraw', async (req, res) => {
    try {
        const { agent_id, amount, momo_number, account_name } = req.body;

        if (!agent_id || !amount || !momo_number || !account_name) {
            return res.status(400).json({ success: false, error: 'Missing withdrawal details.' });
        }

        const { data, error: withdrawError } = await supabase
            .from('withdrawals')
            .insert([
                {
                    agent_id,
                    amount,
                    momo_number,
                    account_name,
                    payout_status: 'requested'
                }
            ])
            .select();

        if (withdrawError) throw withdrawError;

        console.log(`[WITHDRAWAL] Agent ${agent_id} requested cash-out of ${amount} FCFA to ${momo_number} (${account_name})`);

        return res.status(200).json({
            success: true,
            message: 'Withdrawal request queued successfully. Awaiting admin clearance.'
        });
    } catch (err) {
        console.error('[WITHDRAWAL ERROR]', err);
        return res.status(500).json({ success: false, error: 'Failed to process withdrawal request.' });
    }
});

/**
 * Endpoint: POST /api/webhook/payment
 */
app.post('/api/webhook/payment', async (req, res) => {
    try {
        const paymentEvent = req.body;
        console.log('[WEBHOOK] Received payment notification:', paymentEvent);

        const transactionId = paymentEvent.transaction_id;
        const externalReference = paymentEvent.reference;
        const status = paymentEvent.status;

        if (status === 'SUCCESS') {
            await supabase
                .from('orders')
                .update({ payment_status: 'paid_momo', order_status: 'assigned' })
                .eq('id', externalReference);

            console.log(`[PAYMENT] Order ${externalReference} successfully marked as PAID via MoMo webhook.`);
        }

        return res.status(200).json({ received: true });
    } catch (err) {
        console.error('[WEBHOOK ERROR]', err);
        return res.status(500).json({ received: false, error: err.message });
    }
});

// IMPORTANT: We remove app.listen() and export the app wrapped in serverless-http
module.exports.handler = serverless(app);