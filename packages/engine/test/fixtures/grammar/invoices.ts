import { defineCustomObject, defineObject, type InferProperties, p } from '@kalup/core'
import { z } from 'zod'
import { LineSchema } from '../../src/lines'

// Invoices are synced from the billing system once a night.
// Edit keys and aliases here; labels come from the portal.
export const Invoice = defineCustomObject('invoice', {
  labels: { singular: 'Invoice', plural: 'Invoices' },
  primaryDisplayProperty: 'invoice_number',
  requiredProperties: ['invoice_number'],
  searchableProperties: ['invoice_number'],
  secondaryDisplayProperties: ['due_date'],
  groups: {
    // Shown on the record sidebar.
    invoice_details: { label: 'Invoice details' },
    payment: { label: 'Payment' },
  },
  properties: {
    amount: p.number('amount', {
      label: 'Amount',
      group: 'invoice_details',
      fieldType: 'number',
      description: 'Total in the portal\'s currency. Line "1" is the sum.',
      formField: true,
    }),
    dueDate: p.date('due_date').required().readonly(),
    invoiceNumber: p
      .string('invoice_number', {
        label: 'Invoice number',
        group: 'invoice_details',
        fieldType: 'text',
        hasUniqueValue: true,
      })
      .required()
      .readonly(),
    // Kept for reference only. Managed by the finance team by hand.
    'legacy-code': p
      .string('legacy_code', {
        label: 'Legacy code',
        group: 'invoice_details',
        fieldType: 'text',
      })
      .managed(false),
    lines: p
      .json('lines', z.array(LineSchema).min(1), {
        label: 'Lines',
        group: 'invoice_details',
        fieldType: 'textarea',
      })
      .required(),
    paidAt: p.datetime('paid_at').readonly(),
    paymentMethods: p.multiEnum('payment_methods', {
      label: 'Payment methods',
      group: 'payment',
      fieldType: 'checkbox',
      options: [
        { value: 'card', label: 'Card' },
        { value: 'sepa', label: 'SEPA', as: 'bankTransfer', hidden: true, description: 'EU only' },
        { value: 'cash', label: 'Cash' },
      ],
      lifecycle: { options: 'exact', removedOptions: ['cheque'], ignoreChanges: ['label'], preventDestroy: true },
    }),
    region: p.enum('region', {
      label: 'Region',
      group: 'payment',
      fieldType: 'radio',
      options: [{ value: 'eu', label: 'EU' }],
    }),
    status: p.enum('status', {
      options: [
        { value: 'open', label: 'Open' },
        { value: 'paid', label: 'Paid' },
      ],
    }),
    voided: p.boolean('voided', {
      label: 'Voided',
      group: 'payment',
      fieldType: 'booleancheckbox',
    }),
  },
})

export type InvoiceData = InferProperties<typeof Invoice.properties> & { id: string }

export const Ticket = defineObject('tickets', {
  properties: {
    subject: p.string('subject'),
  },
})

export type TicketData = InferProperties<typeof Ticket.properties> & { id: string }
