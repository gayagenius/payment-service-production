import crypto from 'crypto';
import axios from 'axios';

// M-Pesa API configuration
const MPESA_BASE_URL = process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke';
const MPESA_CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
const MPESA_CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const MPESA_PASSKEY = process.env.MPESA_PASSKEY;
const MPESA_SHORTCODE = process.env.MPESA_SHORTCODE || process.env.MPESA_BUSINESS_SHORTCODE;
const MPESA_CALLBACK_URL = process.env.MPESA_CALLBACK_URL;

/**
 * Generate M-Pesa access token
 */
const generateAccessToken = async () => {
    try {
        const auth = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString('base64');
        
        const response = await axios.get(`${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
            headers: {
                'Authorization': `Basic ${auth}`
            }
        });

        return {
            success: true,
            accessToken: response.data.access_token,
            expiresIn: response.data.expires_in
        };
    } catch (error) {
        return {
            success: false,
            error: {
                code: 'MPESA_AUTH_ERROR',
                message: error.response?.data?.errorMessage || error.message
            }
        };
    }
};

/**
 * Generate M-Pesa password
 */
const generatePassword = () => {
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, -3);
    const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString('base64');
    return { password, timestamp };
};

/**
 * Map M-Pesa status to our payment status
 */
const mapMpesaStatus = (mpesaStatus) => {
    const statusMap = {
        '0': 'SUCCEEDED',      // Success
        '1': 'PENDING',        // Pending
        '2': 'FAILED',         // Failed
        '3': 'FAILED',         // Cancelled
        '4': 'FAILED',         // Timeout
        '5': 'FAILED'          // Rejected
    };
    return statusMap[mpesaStatus] || 'FAILED';
};

/**
 * Map M-Pesa refund status to our refund status
 */
const mapMpesaRefundStatus = (mpesaStatus) => {
    const statusMap = {
        '0': 'SUCCEEDED',      // Success
        '1': 'PENDING',        // Pending
        '2': 'FAILED',         // Failed
        '3': 'FAILED',         // Cancelled
        '4': 'FAILED',         // Timeout
        '5': 'FAILED'          // Rejected
    };
    return statusMap[mpesaStatus] || 'FAILED';
};

/**
 * Initiate STK Push for M-Pesa payments
 */
export const initiateSTKPush = async (paymentData) => {
    try {
        const { amount, phoneNumber, accountReference, transactionDesc, metadata, idempotencyKey } = paymentData;

        // Get access token
        const tokenResult = await generateAccessToken();
        if (!tokenResult.success) {
            return tokenResult;
        }

        const { password, timestamp } = generatePassword();

        const requestData = {
            BusinessShortCode: MPESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: amount,
            PartyA: phoneNumber,
            PartyB: MPESA_SHORTCODE,
            PhoneNumber: phoneNumber,
            CallBackURL: MPESA_CALLBACK_URL,
            AccountReference: accountReference,
            TransactionDesc: transactionDesc,
            Metadata: {
                ...metadata,
                idempotency_key: idempotencyKey,
                gateway: 'mpesa'
            }
        };

        const response = await axios.post(
            `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
            requestData,
            {
                headers: {
                    'Authorization': `Bearer ${tokenResult.accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (response.data.ResponseCode === '0') {
            return {
                success: true,
                transactionId: response.data.CheckoutRequestID,
                status: 'PENDING',
                gatewayResponse: {
                    checkout_request_id: response.data.CheckoutRequestID,
                    merchant_request_id: response.data.MerchantRequestID,
                    response_code: response.data.ResponseCode,
                    response_description: response.data.ResponseDescription,
                    customer_message: response.data.CustomerMessage
                }
            };
        } else {
            return {
                success: false,
                error: {
                    code: 'MPESA_STK_PUSH_FAILED',
                    message: response.data.ResponseDescription,
                    responseCode: response.data.ResponseCode
                }
            };
        }
    } catch (error) {
        return {
            success: false,
            error: {
                code: 'MPESA_ERROR',
                message: error.response?.data?.errorMessage || error.message
            }
        };
    }
};

/**
 * Query STK Push status
 */
export const querySTKPushStatus = async (checkoutRequestId) => {
    try {
        const tokenResult = await generateAccessToken();
        if (!tokenResult.success) {
            return tokenResult;
        }

        const { password, timestamp } = generatePassword();

        const requestData = {
            BusinessShortCode: MPESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            CheckoutRequestID: checkoutRequestId
        };

        const response = await axios.post(
            `${MPESA_BASE_URL}/mpesa/stkpushquery/v1/query`,
            requestData,
            {
                headers: {
                    'Authorization': `Bearer ${tokenResult.accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (response.data.ResponseCode === '0') {
            const resultCode = response.data.ResultCode;
            return {
                success: true,
                status: mapMpesaStatus(resultCode),
                gatewayResponse: {
                    checkout_request_id: response.data.CheckoutRequestID,
                    merchant_request_id: response.data.MerchantRequestID,
                    result_code: resultCode,
                    result_desc: response.data.ResultDesc,
                    mpesa_receipt_number: response.data.MpesaReceiptNumber,
                    transaction_date: response.data.TransactionDate,
                    phone_number: response.data.PhoneNumber
                }
            };
        } else {
            return {
                success: false,
                error: {
                    code: 'MPESA_QUERY_FAILED',
                    message: response.data.ResultDesc,
                    resultCode: response.data.ResultCode
                }
            };
        }
    } catch (error) {
        return {
            success: false,
            error: {
                code: 'MPESA_ERROR',
                message: error.response?.data?.errorMessage || error.message
            }
        };
    }
};

/**
 * Process M-Pesa refund (B2C)
 */
export const processRefund = async (refundData) => {
    try {
        const { amount, phoneNumber, transactionId, remarks, metadata, idempotencyKey } = refundData;

        const tokenResult = await generateAccessToken();
        if (!tokenResult.success) {
            return tokenResult;
        }

        const { password, timestamp } = generatePassword();

        const requestData = {
            InitiatorName: 'testapi',
            SecurityCredential: process.env.MPESA_SECURITY_CREDENTIAL, // This should be encrypted
            CommandID: 'TransactionReversal',
            TransactionID: transactionId,
            Amount: amount,
            ReceiverParty: phoneNumber,
            RecieverIdentifierType: '4',
            ResultURL: `${MPESA_CALLBACK_URL}/refund/result`,
            QueueTimeOutURL: `${MPESA_CALLBACK_URL}/refund/timeout`,
            Remarks: remarks || 'Refund',
            Occasion: 'Refund'
        };

        const response = await axios.post(
            `${MPESA_BASE_URL}/mpesa/reversal/v1/request`,
            requestData,
            {
                headers: {
                    'Authorization': `Bearer ${tokenResult.accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (response.data.ResponseCode === '0') {
            return {
                success: true,
                refundId: response.data.OriginatorConversationID,
                status: 'PENDING',
                gatewayResponse: {
                    originator_conversation_id: response.data.OriginatorConversationID,
                    conversation_id: response.data.ConversationID,
                    response_code: response.data.ResponseCode,
                    response_description: response.data.ResponseDescription
                }
            };
        } else {
            return {
                success: false,
                error: {
                    code: 'MPESA_REFUND_FAILED',
                    message: response.data.ResponseDescription,
                    responseCode: response.data.ResponseCode
                }
            };
        }
    } catch (error) {
        return {
            success: false,
            error: {
                code: 'MPESA_ERROR',
                message: error.response?.data?.errorMessage || error.message
            }
        };
    }
};

/**
 * Verify M-Pesa webhook signature
 */
export const verifyWebhook = (payload, signature) => {
    try {
        // M-Pesa doesn't use signature verification like Stripe
        // Instead, we validate the payload structure and required fields
        const data = JSON.parse(payload);
        
        if (!data.Body || !data.Body.stkCallback) {
            return {
                success: false,
                error: {
                    code: 'INVALID_WEBHOOK_PAYLOAD',
                    message: 'Invalid M-Pesa webhook payload structure'
                }
            };
        }

        return { success: true, event: data };
    } catch (error) {
        return {
            success: false,
            error: {
                code: 'WEBHOOK_VERIFICATION_FAILED',
                message: error.message
            }
        };
    }
};

/**
 * Handle M-Pesa webhook events
 */
export const handleWebhook = async (event) => {
    try {
        const { Body } = event;
        const { stkCallback } = Body;

        if (!stkCallback) {
            return {
                success: false,
                error: {
                    code: 'INVALID_WEBHOOK_EVENT',
                    message: 'Invalid M-Pesa webhook event structure'
                }
            };
        }

        const { ResultCode, ResultDesc, CallbackMetadata, CheckoutRequestID } = stkCallback;

        if (ResultCode === '0') {
            // Payment successful
            const metadata = CallbackMetadata?.Item || [];
            const mpesaReceiptNumber = metadata.find(item => item.Name === 'MpesaReceiptNumber')?.Value;
            const transactionDate = metadata.find(item => item.Name === 'TransactionDate')?.Value;
            const phoneNumber = metadata.find(item => item.Name === 'PhoneNumber')?.Value;

            return {
                success: true,
                paymentId: CheckoutRequestID,
                status: 'SUCCEEDED',
                gatewayResponse: {
                    checkout_request_id: CheckoutRequestID,
                    result_code: ResultCode,
                    result_desc: ResultDesc,
                    mpesa_receipt_number: mpesaReceiptNumber,
                    transaction_date: transactionDate,
                    phone_number: phoneNumber
                }
            };
        } else {
            // Payment failed
            return {
                success: true,
                paymentId: CheckoutRequestID,
                status: mapMpesaStatus(ResultCode),
                gatewayResponse: {
                    checkout_request_id: CheckoutRequestID,
                    result_code: ResultCode,
                    result_desc: ResultDesc
                }
            };
        }
    } catch (error) {
        return {
            success: false,
            error: {
                code: 'WEBHOOK_HANDLING_FAILED',
                message: error.message
            }
        };
    }
};

/**
 * Generate M-Pesa phone number validation
 */
export const validatePhoneNumber = (phoneNumber) => {
    // Remove any non-digit characters
    const cleaned = phoneNumber.replace(/\D/g, '');
    
    // Check if it's a valid Kenyan phone number
    if (cleaned.length === 12 && cleaned.startsWith('254')) {
        return { valid: true, formatted: cleaned };
    } else if (cleaned.length === 10 && cleaned.startsWith('0')) {
        return { valid: true, formatted: `254${cleaned.substring(1)}` };
    } else if (cleaned.length === 9) {
        return { valid: true, formatted: `254${cleaned}` };
    } else {
        return { 
            valid: false, 
            error: 'Invalid phone number format. Expected: 254XXXXXXXXX, 07XXXXXXXX, or 7XXXXXXXX' 
        };
    }
};
