import type { Metadata } from 'next'
import PageHeader from '@/components/PageHeader'
import { ENDPOINTS } from '@/lib/api/registry'
import {
  DATA_LICENSE,
  DATA_LICENSE_URL,
  API_BASE_PATH,
} from '@/lib/api/constants'
import styles from './page.module.css'

// Spelled out so the copy reads naturally; digits past twelve.
const COUNT_WORDS = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
]
const COLLECTION_COUNT =
  COUNT_WORDS[ENDPOINTS.length] ?? String(ENDPOINTS.length)

export const metadata: Metadata = {
  title: 'Developer API – AISafety.com',
  description:
    'Public, read-only JSON API over the AISafety.com directories: communities, events, organizations, jobs, funding and more. Free to use under CC-BY-4.0.',
}

const QUICK_START = `// Upcoming events in Europe. No API key, no database needed.
const res = await fetch(
  'https://aisafety.com${API_BASE_PATH}/events?location=Europe'
)
const { data, meta } = await res.json()
console.log(data.length, 'events ·', meta.license)`

const ENVELOPE = `{
  "data": [
    {
      "id": "rec...",
      "name": "...",
      "type": "Conference",
      "location": "Europe",
      "startDate": "2026-07-01",
      "applicationsClose": "2026-06-20",
      "url": "https://..."
    }
  ],
  "meta": {
    "count": 1,
    "license": "CC-BY-4.0",
    "attribution": "AISafety.com",
    "source": "https://aisafety.com",
    "generatedAt": "2026-06-16T00:00:00.000Z"
  }
}`

export default function DevelopersPage() {
  return (
    <div className={`container-default ${styles.page}`}>
      <PageHeader
        title="Data API"
        description={
          <>
            A public, read-only JSON API over the AISafety.com directories. Pull
            live communities, events, organizations, jobs, funding and more into
            your own site or tool, with{' '}
            <span className="color-light-teal">
              no API key and no database to maintain.
            </span>
          </>
        }
      />

      <div className={styles.heroActions}>
        <a className="button-primary" href={`${API_BASE_PATH}/openapi.json`}>
          OpenAPI spec
        </a>
        <a className="button-secondary" href={API_BASE_PATH}>
          API index
        </a>
        <a
          className="button-secondary"
          href={DATA_LICENSE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          {DATA_LICENSE}
        </a>
      </div>
      <p className={styles.baseUrl}>
        <span>Base URL</span>
        <code className={styles.inline}>
          https://aisafety.com{API_BASE_PATH}
        </code>
      </p>

      <section className={styles.section}>
        <h2>Quick start</h2>
        <p className={`paragraph-small ${styles.sectionLead}`}>
          Every endpoint is a plain GET that returns JSON. No auth; CORS is open
          to any origin.
        </p>
        <pre className={styles.code}>
          <code>{QUICK_START}</code>
        </pre>
      </section>

      <section className={styles.section}>
        <h2>Endpoints</h2>
        <p className={`paragraph-small ${styles.sectionLead}`}>
          {COLLECTION_COUNT} collections. Click any card to open its live JSON.
        </p>
        <div className={styles.endpointGrid}>
          {ENDPOINTS.map(endpoint => (
            <a
              key={endpoint.slug}
              href={`${API_BASE_PATH}/${endpoint.slug}`}
              className={`card ${styles.endpointCard}`}
            >
              <span className={styles.cardHead}>
                <span className={styles.method}>GET</span>
                <code className={styles.path}>
                  {API_BASE_PATH}/{endpoint.slug}
                </code>
              </span>
              <p className={styles.cardDesc}>{endpoint.description}</p>
              {endpoint.filterFields.length > 0 && (
                <span className={styles.tags}>
                  {endpoint.filterFields.map(field => (
                    <span key={field} className={styles.tag}>
                      {field}
                    </span>
                  ))}
                </span>
              )}
            </a>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2>Response shape</h2>
        <p className={`paragraph-small ${styles.sectionLead}`}>
          Every endpoint returns the same wrapped envelope: a{' '}
          <code className={styles.inline}>data</code> array and a{' '}
          <code className={styles.inline}>meta</code> object with the record
          count, license, and attribution. IDs are stable Airtable record IDs,
          image fields are absolute URLs, and dates are ISO-8601.
        </p>
        <pre className={styles.code}>
          <code>{ENVELOPE}</code>
        </pre>
      </section>

      <section className={styles.section}>
        <h2>Filtering &amp; search</h2>
        <ul className={styles.filterList}>
          <li className={styles.filterRow}>
            <code className={styles.inline}>?type=Conference</code>
            <span>Filter by any listed field. Case-insensitive substring.</span>
          </li>
          <li className={styles.filterRow}>
            <code className={styles.inline}>?location=Europe,UK</code>
            <span>Comma-separate values for OR.</span>
          </li>
          <li className={styles.filterRow}>
            <code className={styles.inline}>
              ?location=Europe&amp;type=Conference
            </code>
            <span>Combine different fields for AND.</span>
          </li>
          <li className={styles.filterRow}>
            <code className={styles.inline}>?q=alignment</code>
            <span>Free-text search across all fields.</span>
          </li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>License &amp; attribution</h2>
        <p className={`paragraph-small ${styles.license}`}>
          Data is licensed{' '}
          <a
            className="color-teal underline"
            href={DATA_LICENSE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Creative Commons Attribution 4.0 ({DATA_LICENSE})
          </a>
          . Use it for any purpose, including commercially, as long as you
          credit AISafety.com with a link back to{' '}
          <a className="color-teal underline" href="https://aisafety.com">
            aisafety.com
          </a>
          . Organization logos remain the property of their respective owners.
        </p>
      </section>
    </div>
  )
}
