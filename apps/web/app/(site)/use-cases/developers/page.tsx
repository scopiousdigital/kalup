import type { Metadata } from 'next'
import { SectionHead } from '@/components/site/primitives'
import { Code, PlanStep } from '@/components/site/product'
import { Terminal } from '@/components/site/terminal'
import { STAGE } from '@/lib/site-data'
import { UseCasePage } from '../_components/use-case'

export const metadata: Metadata = {
  title: 'For developers',
  description:
    'Keep HubSpot properties in TypeScript next to your app. The same files type your code, a plan shows each portal change, and apply writes it to your sandbox. Open source, on npm.',
}

const PROPERTY = `// kalup/objects/companies.ts
renewalDate: p.date('renewal_date', { label: 'Renewal date', group: 'billing', fieldType: 'date' }),`

const CI = `# The apply job after merge to main, abridged. A design, not yet run in a real CI.
concurrency: { group: kalup-portal-2222222, cancel-in-progress: false }
env: { KALUP_STATE_DIR: .kalup-state/state }
steps:
  - run: git fetch origin kalup-state/portal-2222222 && git worktree add -B kalup-state/portal-2222222 .kalup-state FETCH_HEAD
  - run: npx kalup plan --target production --out plan.json
  - run: npx kalup apply plan.json --approve "$REVIEWED_HASH"   # the writesHash posted on the pull request
  - if: always()
    run: cd .kalup-state && git add state && git commit -m "Apply $GITHUB_SHA" && git push origin HEAD:kalup-state/portal-2222222`

const CODECS = `import { propertyNames } from '@kalup/core'
import { Company } from '../hubspot'

// Ask HubSpot for exactly the properties the object file names
const url = \`https://api.hubapi.com/crm/v3/objects/companies/1234?properties=\${propertyNames(Company).join(',')}\`
const res = await fetch(url, { headers: { Authorization: \`Bearer \${process.env.HUBSPOT_TOKEN}\` } })
const { properties } = await res.json()

const status = Company.properties.billingStatus.get(properties)
// 'active' | 'past_due' | Unlisted | null: 'PAST DUE' in the portal reads as 'past_due'

const update: Record<string, string> = {}
Company.properties.billingStatus.set(update, 'past_due') // { billing_status: 'PAST DUE' }`

export default function DevelopersPage() {
  return (
    <UseCasePage
      persona="developers"
      lede={
        <p>
          Keep the portal's properties in TypeScript next to your code. The same files type the app, and a reviewed plan
          puts the property in place before the code that reads it ships.
        </p>
      }
      flowTitle="A property, from branch to production."
      flowLede="The same review as any other change: a branch, a diff, a pull request and a CI job."
      steps={[
        {
          title: 'Add the property on a branch',
          body: (
            <>
              Add one line to <code className="font-mono">kalup/objects/companies.ts</code>. The app code that uses{' '}
              <code className="font-mono">CompanyData.renewalDate</code> type-checks at once. No generate step.
            </>
          ),
        },
        {
          title: 'Plan against your sandbox',
          command: 'kalup plan --target sandbox --out plan.json',
          body: 'The plan shows one safe create and saves it for review. Nothing is written to the portal.',
        },
        {
          title: 'Apply to your sandbox',
          command: 'kalup apply plan.json',
          body: 'Apply writes the saved plan to the sandbox once you type its name, so you can test against a real portal.',
        },
        {
          title: 'Open a pull request',
          command: 'kalup plan --target production --out plan.json',
          body: 'In the CI recipe, a job plans against production and posts the plan and its writesHash as a comment, so reviewers see the portal change next to the code change.',
          stage: STAGE.design,
        },
        {
          title: 'Merge, then CI applies',
          command: 'kalup apply plan.json --approve <writesHash>',
          body: 'The job that alone holds the production write key plans again and applies with the reviewed hash, then the app deploys. If anything moved since the review, apply stops and writes nothing.',
          stage: STAGE.design,
        },
        {
          title: 'Undo with a revert',
          body: 'There is no rollback command. Revert the commit and plan again: the plan proposes the reverse of what config owns. The property this change created stays, since absence never deletes.',
        },
      ]}
      proof={
        <>
          <SectionHead
            address="ci:recipe"
            title="The plan rides along with the pull request."
            lede="In the CI recipe, documented but not yet run in a real CI, the pull request carries the plan. The plan below is what the released CLI prints."
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="grid content-start gap-4">
              <Code file="kalup/objects/companies.ts" code={PROPERTY} />
              <PlanStep
                op="+"
                title={'Create property "Renewal date" (renewal_date) on companies'}
                address="property:companies/renewal_date"
                risk="safe"
                changes={[
                  { unit: 'label', kind: 'add', detail: '"Renewal date"' },
                  { unit: 'type', kind: 'add', detail: 'date · fieldType date' },
                  { unit: 'group', kind: 'add', detail: 'group:companies/billing' },
                ]}
                expect="expect: does not exist yet"
              />
            </div>
            <Terminal
              title="ci design · pull request #42"
              command="npx kalup plan --target production"
              stage={STAGE.design}
              output={[
                'Plan pl_cb9ea21f2c5b for target production, portal 2222222 (STANDARD, protected)',
                [
                  { text: 's1 ' },
                  { text: 'safe', tone: 'add' },
                  { text: ' Adopt property group "Billing" (billing) on companies' },
                ],
                [
                  { text: 's2 ' },
                  { text: 'safe', tone: 'add' },
                  { text: ' Adopt property "Billing status" (billing_status) on companies' },
                ],
                [
                  { text: 's3 ' },
                  { text: 'safe', tone: 'add' },
                  { text: ' Create property "Renewal date" (renewal_date) on companies' },
                ],
                '3 safe, 0 risky, 0 destructive, 0 blocked, 0 manual; 0 held',
                [{ text: 'Coverage: complete; 0 unsupported, 0 excluded.', tone: 'muted' }],
                [{ text: 'About 11 API calls; 999991 left today.', tone: 'muted' }],
                [{ text: '1 internal name created here can never be renamed.', tone: 'muted' }],
                [
                  {
                    text: 'Not copied, HubSpot has no API: conditional property logic, field-level permissions.',
                    tone: 'muted',
                  },
                ],
              ]}
            />
          </div>
          <div className="mt-4">
            <Code file=".github/workflows/kalup.yml" code={CI} />
          </div>
          <div className="mt-[clamp(48px,6vw,80px)] grid items-start gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="grid content-start gap-4">
              <h3 className="display text-h3">The same files type your app</h3>
              <p className="max-w-[56ch] text-[15px] text-graphite">
                <code className="font-mono">@kalup/core</code> reads and writes the{' '}
                <code className="font-mono">properties</code> of a CRM record with the types from your object files, so{' '}
                <code className="font-mono">'PAST DUE'</code> in the portal is{' '}
                <code className="font-mono">'past_due'</code> in your code. Later,{' '}
                <code className="font-mono">@kalup/client</code> will read, write and search records for you. The types
                and codecs work without it today.
              </p>
            </div>
            <Code file="app/billing.ts" code={CODECS} />
          </div>
        </>
      }
      notFor={[
        {
          title: 'It does not move records.',
          body: 'Kalup moves configuration, never contacts, companies or deals. A later typed client would read and write records for your app, not migrate them.',
        },
        {
          title: 'It does not replace the hs CLI.',
          body: "Apps, CMS themes and serverless functions stay with HubSpot's own CLI. Use hs for the app and Kalup for the portal.",
        },
        {
          title: 'It has no rollback button.',
          body: 'Reverting config and planning again proposes the reverse of the changes config owns. Absence never deletes, so a created property stays, and so does an added option, since options are additive by default. A partial apply exits 5, and you plan again from where the portal is.',
        },
      ]}
    />
  )
}
