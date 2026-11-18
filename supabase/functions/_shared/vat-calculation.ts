// VAT calculation utilities for MobiWave WA commercial functions
// Supports Kenyan VAT regulations

export interface VATCalculation {
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  currency: string;
}

export interface InvoiceLineItem {
  description: string;
  amount: number;
  vat_applicable: boolean;
}

// Kenyan VAT rate (16%)
export const KENYAN_VAT_RATE = 0.16;

// VAT calculation
export class VATCalculator {
  private readonly vatRate: number;

  constructor(vatRate: number = KENYAN_VAT_RATE) {
    this.vatRate = vatRate;
  }

  // Calculate VAT for an amount
  calculateVAT(amount: number): VATCalculation {
    const vatAmount = Math.round(amount * this.vatRate * 100) / 100;
    const total = Math.round((amount + vatAmount) * 100) / 100;

    return {
      subtotal: amount,
      vat_rate: this.vatRate,
      vat_amount: vatAmount,
      total,
      currency: 'KES'
    };
  }

  // Calculate VAT for multiple line items
  calculateVATForItems(items: InvoiceLineItem[]): VATCalculation {
    let subtotal = 0;
    let vatAmount = 0;

    for (const item of items) {
      subtotal += item.amount;
      if (item.vat_applicable) {
        vatAmount += Math.round(item.amount * this.vatRate * 100) / 100;
      }
    }

    const total = Math.round((subtotal + vatAmount) * 100) / 100;

    return {
      subtotal,
      vat_rate: this.vatRate,
      vat_amount: vatAmount,
      total,
      currency: 'KES'
    };
  }

  // Format VAT breakdown for display
  formatVATBreakdown(calculation: VATCalculation): string {
    return `
Subtotal: KES ${calculation.subtotal.toFixed(2)}
VAT (${(calculation.vat_rate * 100).toFixed(0)}%): KES ${calculation.vat_amount.toFixed(2)}
Total: KES ${calculation.total.toFixed(2)}
    `.trim();
  }

  // Get VAT rate percentage
  getVATRatePercentage(): number {
    return this.vatRate * 100;
  }
}

// Invoice generator with VAT calculation
export class InvoiceGenerator {
  private vatCalculator: VATCalculator;

  constructor(vatRate?: number) {
    this.vatCalculator = new VATCalculator(vatRate);
  }

  // Generate invoice with VAT breakdown
  generateInvoice(
    tenantId: string,
    items: InvoiceLineItem[],
    invoiceNumber?: string
  ): {
    invoice_number: string;
    tenant_id: string;
    items: InvoiceLineItem[];
    subtotal: number;
    vat_amount: number;
    total_amount: number;
    currency: string;
    vat_rate: number;
    generated_at: string;
  } {
    const vatCalculation = this.vatCalculator.calculateVATForItems(items);

    return {
      invoice_number: invoiceNumber || `MW-${tenantId}-${Date.now()}`,
      tenant_id: tenantId,
      items,
      subtotal: vatCalculation.subtotal,
      vat_amount: vatCalculation.vat_amount,
      total_amount: vatCalculation.total,
      currency: 'KES',
      vat_rate: vatCalculation.vat_rate,
      generated_at: new Date().toISOString()
    };
  }

  // Generate platform invoice with Meta cost as separate line item
  generatePlatformInvoice(
    tenantId: string,
    platformFee: number,
    metaCost: number,
    invoiceNumber?: string
  ): {
    invoice_number: string;
    tenant_id: string;
    platform_fee: number;
    meta_cost: number;
    vat_amount: number;
    total_amount: number;
    currency: string;
    vat_rate: number;
    generated_at: string;
  } {
    // Meta cost is not subject to VAT (pass-through)
    const vatApplicableAmount = platformFee;
    const vatCalculation = this.vatCalculator.calculateVAT(vatApplicableAmount);

    const totalAmount = platformFee + metaCost + vatCalculation.vat_amount;

    return {
      invoice_number: invoiceNumber || `MW-${tenantId}-${Date.now()}`,
      tenant_id: tenantId,
      platform_fee: platformFee,
      meta_cost: metaCost,
      vat_amount: vatCalculation.vat_amount,
      total_amount: Math.round(totalAmount * 100) / 100,
      currency: 'KES',
      vat_rate: this.vatCalculator.getVATRatePercentage(),
      generated_at: new Date().toISOString()
    };
  }
}

// Export default instances
export const vatCalculator = new VATCalculator();
export const invoiceGenerator = new InvoiceGenerator();

// Format currency for Kenyan shillings
export function formatKES(amount: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

// Format VAT rate as percentage
export function formatVATRate(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}