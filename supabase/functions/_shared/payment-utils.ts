// Payment utilities for MobiWave WA commercial functions

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CommercialError, ErrorCode, createPaymentError, createMpesaError } from './error-handling.ts';

export interface PaymentAmount {
  amount: number;
  currency: string;
}

export interface MpesaCredentials {
  consumer_key: string;
  consumer_secret: string;
  shortcode: string;
  passkey: string;
  environment: 'sandbox' | 'production';
}

export interface PaymentVerificationResult {
  is_valid: boolean;
  transaction_id: string;
  amount: number;
  status: string;
  timestamp: string;
  reference?: string;
}

// Payment lock mechanism
export class PaymentLock {
  private static locks = new Map<string, Promise<any>>();
  
  static async acquire(lockKey: string): Promise<() => void> {
    // Check if lock already exists
    if (this.locks.has(lockKey)) {
      // Wait for existing lock to release
      await this.locks.get(lockKey);
    }
    
    // Create a new lock
    const releaseLock = () => {
      this.locks.delete(lockKey);
    };
    
    const lockPromise = new Promise<void>((resolve) => {
      // Store the promise in the locks map
      this.locks.set(lockKey, new Promise((lockResolve) => {
        // When the operation completes, resolve the lock
        lockResolve();
        resolve();
      }));
    });
    
    return releaseLock;
  }
}

// Server-side idempotency key tracking
export class IdempotencyTracker {
  private static cache = new Map<string, { timestamp: number; data: any }>();
  private static readonly TTL = 24 * 60 * 60 * 1000; // 24 hours
  
  static async track(key: string, data: any): Promise<void> {
    const now = Date.now();
    
    // Clean up expired entries
    this.cleanupExpired();
    
    // Store the idempotency key
    this.cache.set(key, {
      timestamp: now,
      data
    });
  }
  
  static async get(key: string): Promise<any | null> {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }
    
    // Check if expired
    if (Date.now() - entry.timestamp > this.TTL) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }
  
  static async exists(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }
  
  private static cleanupExpired(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.TTL) {
        expiredKeys.push(key);
      }
    }
    
    expiredKeys.forEach(key => this.cache.delete(key));
  }
}

// M-Pesa API utilities
export class MpesaApi {
  private static client: any;
  private static credentials: MpesaCredentials | null = null;
  
  static async initialize(credentials: MpesaCredentials): Promise<void> {
    this.credentials = credentials;
    
    // Create HTTP client with proper headers
    this.client = {
      async request(url: string, options: any = {}) {
        const headers = {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${btoa(`${credentials.consumer_key}:${credentials.consumer_secret}`)}`
        };
        
        const response = await fetch(url, {
          ...options,
          headers: { ...headers, ...options.headers }
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`M-Pesa API error: ${response.status} - ${errorText}`);
        }
        
        return response.json();
      }
    };
  }
  
  static async getAccessToken(): Promise<string> {
    if (!this.credentials) {
      throw createMpesaError('M-Pesa credentials not initialized');
    }
    
    const authUrl = this.credentials.environment === 'production'
      ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
      : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';
    
    const response = await this.client.request(authUrl);
    
    if (!response.access_token) {
      throw createMpesaError('Failed to get M-Pesa access token', response);
    }
    
    return response.access_token;
  }
  
  static async initiateStkPush(
    amount: number,
    phoneNumber: string,
    checkoutRequestId: string,
    callbackUrl: string
  ): Promise<any> {
    if (!this.credentials) {
      throw createMpesaError('M-Pesa credentials not initialized');
    }
    
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = btoa(`${this.credentials.shortcode}${this.credentials.passkey}${timestamp}`);
    
    const stkPushUrl = this.credentials.environment === 'production'
      ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
      : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';
    
    const stkPushRequest = {
      BusinessShortCode: this.credentials.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount * 100), // Convert to cents
      PartyA: phoneNumber,
      PartyB: this.credentials.shortcode,
      PhoneNumber: phoneNumber,
      CallBackURL: callbackUrl,
      AccountReference: `MobiWave-${Date.now()}`,
      TransactionDesc: `MobiWave Subscription Payment`
    };
    
    const accessToken = await this.getAccessToken();
    
    return this.client.request(stkPushUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(stkPushRequest)
    });
  }
  
  static async queryTransactionStatus(
    checkoutRequestId: string,
    transactionId: string
  ): Promise<any> {
    if (!this.credentials) {
      throw createMpesaError('M-Pesa credentials not initialized');
    }
    
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = btoa(`${this.credentials.shortcode}${this.credentials.passkey}${timestamp}`);
    
    const queryUrl = this.credentials.environment === 'production'
      ? 'https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query'
      : 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query';
    
    const queryRequest = {
      BusinessShortCode: this.credentials.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId
    };
    
    const accessToken = await this.getAccessToken();
    
    return this.client.request(queryUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(queryRequest)
    });
  }
}

// Payment validation utilities
export class PaymentValidator {
  static validateAmount(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw createPaymentError('Invalid payment amount', { amount });
    }
    
    // Check maximum amount (KES 1,000,000)
    if (amount > 1000000) {
      throw createPaymentError('Payment amount exceeds maximum limit', { amount, max: 1000000 });
    }
  }
  
  static validatePhoneNumber(phoneNumber: string): void {
    // Basic Kenyan phone number validation
    const kenyanPhoneRegex = /^\+254[17]\d{8}$/;
    if (!kenyanPhoneRegex.test(phoneNumber)) {
      throw createPaymentError('Invalid Kenyan phone number', { phoneNumber });
    }
  }
  
  static validateCurrency(currency: string): void {
    const validCurrencies = ['KES', 'USD', 'EUR'];
    if (!validCurrencies.includes(currency)) {
      throw createPaymentError('Unsupported currency', { currency });
    }
  }
  
  static async validateInvoiceAmount(
    supabase: any,
    tenantId: string,
    expectedAmount: number
  ): Promise<void> {
    // Get the latest invoice for the tenant
    const { data: invoice, error } = await supabase
      .from('platform_invoices')
      .select('amount')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (error || !invoice) {
      throw createPaymentError('Could not validate invoice amount', { error: error?.message });
    }
    
    // Check if the payment amount matches the invoice amount
    if (Math.abs(invoice.amount - expectedAmount) > 0.01) {
      throw createPaymentError(
        'Payment amount does not match invoice amount',
        { expected: expectedAmount, actual: invoice.amount }
      );
    }
  }
}

// Payment verification service
export class PaymentVerificationService {
  static async verifyPayment(
    supabase: any,
    tenantId: string,
    paymentData: any
  ): Promise<PaymentVerificationResult> {
    const { transaction_id, amount, status } = paymentData;
    
    // Validate payment data
    if (!transaction_id || !amount || !status) {
      throw createPaymentError('Invalid payment data', paymentData);
    }
    
    // Check if payment already exists and is verified
    const existingPayment = await supabase
      .from('platform_payments')
      .select('id, status')
      .eq('tenant_id', tenantId)
      .eq('mpesa_transaction_id', transaction_id)
      .single();
    
    if (existingPayment && existingPayment.status === 'completed') {
      // Payment already verified
      return {
        is_valid: true,
        transaction_id,
        amount,
        status: existingPayment.status,
        timestamp: new Date().toISOString()
      };
    }
    
    // Verify payment with M-Pesa API
    const { data: mpesaConfig } = await supabase
      .from('mpesa_config')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single();
    
    if (!mpesaConfig) {
      throw createPaymentError('M-Pesa configuration not found', { tenant_id: tenantId });
    }
    
    // Initialize M-Pesa API
    await MpesaApi.initialize(mpesaConfig);
    
    // Query transaction status from M-Pesa
    const checkoutRequestId = paymentData.checkout_request_id;
    if (!checkoutRequestId) {
      throw createPaymentError('Missing checkout request ID', { transaction_id });
    }
    
    const mpesaResponse = await MpesaApi.queryTransactionStatus(checkoutRequestId, transaction_id);
    
    // Verify the response
    if (mpesaResponse.ResultCode !== 0) {
      throw createPaymentError(
        'M-Pesa payment verification failed',
        { 
          result_code: mpesaResponse.ResultCode,
          result_description: mpesaResponse.ResultDesc,
          transaction_id 
        }
      );
    }
    
    // Verify amount matches
    const mpesaAmount = mpesaResponse.CallbackMetadata?.Item?.find((item: any) => item.Name === 'Amount')?.Value;
    if (mpesaAmount && Math.abs(mpesaAmount - amount) > 0.01) {
      throw createPaymentError(
        'Payment amount mismatch',
        { 
          expected_amount: amount,
          actual_amount: mpesaAmount,
          transaction_id 
        }
      );
    }
    
    // Payment is valid
    return {
      is_valid: true,
      transaction_id,
      amount,
      status: 'verified',
      timestamp: new Date().toISOString(),
      reference: mpesaResponse.MerchantRequestID
    };
  }
}

// Payment amount formatter
export class PaymentFormatter {
  static formatCurrency(amount: number, currency: string = 'KES'): string {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }
  
  static formatAmountForMpesa(amount: number): number {
    // Convert to cents (KES uses 2 decimal places)
    return Math.round(amount * 100);
  }
  
  static parseAmount(amountStr: string): number {
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      throw createPaymentError('Invalid amount format', { amount: amountStr });
    }
    return amount;
  }
}

// Payment audit logging
export class PaymentAuditor {
  static async logPaymentEvent(
    supabase: any,
    tenantId: string,
    event: string,
    details: Record<string, any>
  ): Promise<void> {
    try {
      await supabase.from('payment_audit_logs').insert({
        tenant_id: tenantId,
        event,
        details,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to log payment audit event:', error);
      // Don't fail the operation if audit logging fails
    }
  }
}