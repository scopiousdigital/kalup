import type { Metadata } from 'next'
import { CropMarks, SectionHead } from '@/components/site/primitives'
import { Code } from '@/components/site/product'
import { Terminal } from '@/components/site/terminal'
import { UseCasePage } from '../_components/use-case'

export const metadata: Metadata = {
  title: 'For agencies',
  description:
    'Pull each client HubSpot portal into files, set it up from a shared blueprint, write its data dictionary and see what changed since last time. One repo per client.',
}

const DICTIONARY = `<!-- an excerpt of kalup docs output -->
# acme\\-crm data dictionary

Source: the config files.

## companies

### Properties

| Internal name | Key | Label | Type | Field type | Group | Managed or reference | Codec | Required | Description |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| billing\\_status | billingStatus | Billing status | enumeration | select | billing | managed | enum | no |  |
| renewal\\_date | renewalDate | Renewal date | date | date | billing | managed | date | no |  |`

const LAYOUT = `acme-crm/             one repo per client
  kalup.config.ts     targets: sandbox 1111111, production 2222222
  hubspot/objects/    companies.ts, deals.ts, subscription.ts
  .kalup/snapshots/   production/20260901T090000000Z.json`

export default function AgenciesPage() {
  return (
    <UseCasePage
      persona="agencies"
      lede={
        <p>
          Setting up a client portal is a checklist and a person clicking through it, rebuilt for every client. Kalup
          turns each portal into files you can read, document and compare. Keep one repo per client.
        </p>
      }
      flowTitle="From an existing portal to a documented one."
      flowLede="Start from what the client already has. Nothing here writes to a portal."
      steps={[
        {
          title: 'Pull the client portal into files',
          command: 'kalup pull',
          body: 'Brings the objects, groups and properties of an existing portal into config. Nothing to write by hand.',
        },
        {
          title: 'Write the data dictionary',
          command: 'kalup docs',
          body: 'A Markdown data dictionary generated from the files, so the documentation is never older than your files.',
        },
        {
          title: 'See what has not been promoted',
          command: 'kalup compare sandbox production',
          body: 'Shows what a colleague built in the sandbox and has not moved to production yet, edits included.',
        },
        {
          title: 'Know what changed since last time',
          command: 'kalup snapshot --target production',
          body: 'Saves a scoped observation of the configuration, with what could not be read listed. Compare against it later to see what changed in the portal since.',
        },
        {
          title: 'Reuse a setup across clients',
          command: 'kalup add ../blueprints/renewals-1.0.0.json',
          body: "Blueprints: a versioned setup you add to each client repo. kalup blueprint upgrade merges a new version into each and keeps the client's own changes. No portal changes until someone plans and applies.",
        },
      ]}
      proof={
        <>
          <SectionHead
            address="compare:sandbox/production"
            title="What your colleague built, and never moved."
            lede="Compare takes two sides, each a target, a snapshot file or your config, and lists the differences in the same shape as a plan."
          />
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Terminal
              title="acme-crm · zsh"
              command="kalup compare sandbox production"
              output={[
                [{ text: 'a: target sandbox, portal 1111111', tone: 'muted' }],
                [{ text: 'b: target production, portal 2222222', tone: 'muted' }],
                '3 equal, 1 differ, 1 only in a, 0 only in b, 0 unmanaged, 0 unknown, 0 excluded',
                [{ text: 'differs: ', tone: 'hold' }, { text: 'property:companies/billing_status' }],
                [
                  {
                    text: '  add options[PAST DUE]: null -> {"value":"PAST DUE","label":"Past due","hidden":false,"description":""}',
                    tone: 'add',
                  },
                ],
                [{ text: 'only in a: ', tone: 'add' }, { text: 'property:companies/renewal_date' }],
              ]}
            />
            <Code file="docs/data-dictionary.md" code={DICTIONARY} />
          </div>
          <div className="relative mt-4 grid gap-3 border border-line-strong bg-paper p-5 md:grid-cols-[220px_minmax(0,1fr)] md:gap-8">
            <CropMarks />
            <b className="font-semibold">One repo per client</b>
            <pre className="overflow-x-auto font-mono text-[13px] leading-[1.7] text-graphite">{LAYOUT}</pre>
          </div>
        </>
      }
      notFor={[
        {
          title: 'It does not move records.',
          body: 'Setting up a portal moves configuration only. Contacts, companies and deals stay where they are.',
        },
        {
          title: 'A snapshot is not a backup.',
          body: 'A snapshot is a scoped observation of the configuration, with what could not be read listed. It holds no record values, and nothing restores from it.',
        },
        {
          title: 'It does not click through the UI for you.',
          body: 'Record page layouts, saved views and conditional property logic have no public API. The plan says so, and a person makes those changes. Printed steps for them come later.',
        },
      ]}
    />
  )
}
