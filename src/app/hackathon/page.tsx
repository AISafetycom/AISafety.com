import ApplicationForm from './ApplicationForm'
import styles from './page.module.css'

const OG_DESCRIPTION = 'A four-day, in-person hackathon to improve the site.'

export const metadata = {
  title: 'Hackathon 2026 – AISafety.com',
  description:
    'Join the AISafety.com team at CEEALAR in Blackpool, England, 17–20 September 2026, for a four-day hackathon to improve the site. Free to attend – applications closed 14 August 2026.',
  alternates: { canonical: '/hackathon' },
  openGraph: {
    title: 'AISafety.com Hackathon 2026',
    description: OG_DESCRIPTION,
    images: [{ url: '/images/link-preview.jpg' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AISafety.com Hackathon 2026',
    description: OG_DESCRIPTION,
    images: ['/images/link-preview.jpg'],
  },
}

export default function HackathonPage() {
  return (
    <div className="container-default">
      <div className={styles.layout}>
        <div>
          <h1 className="padding-top-56px padding-bottom-24px">
            AISafety.com Hackathon 2026
          </h1>

          <h2 className="padding-bottom-40px">
            A four-day, in-person hackathon to{' '}
            <span className="color-light-teal">
              improve the AI safety resource hub
            </span>
            .
          </h2>

          <p className="padding-bottom-16px">
            <strong>When</strong>
            <br />
            Thursday 17th September – Sunday 20th September 2026
          </p>
          <p className="padding-bottom-16px">
            <strong>Where</strong>
            <br />
            <a
              href="https://www.ceealar.org"
              target="_blank"
              rel="noopener noreferrer"
              className="color-light-teal"
            >
              CEEALAR
            </a>{' '}
            (the EA Hotel) in Blackpool, England
          </p>
          <p className="padding-bottom-16px">
            <strong>Cost</strong>
            <br />
            Free, including accommodation and all meals
          </p>
          <p className="padding-bottom-40px">
            <strong>Applications closed</strong>
            <br />
            14 August 2026 (decisions by 21 August). We may still consider late
            applications from very strong candidates.
          </p>

          <p className="color-teal-300 padding-bottom-40px">
            Once a year, the core AISafety.com team gets together with a group
            of amazing volunteers and spends an extended weekend getting a bunch
            of stuff done to improve the site. We also do some relaxed fun
            activities between work sessions.
          </p>
          <h3 className="padding-bottom-16px">Who we&apos;re looking for</h3>
          <ul
            className={`color-teal-300 padding-bottom-40px ${styles.bullets}`}
          >
            <li>
              <strong>Product managers and designers</strong>
              <ul>
                <li>
                  To execute the vision for new projects, build out design
                  mockups, conduct user research, offer consulting, and
                  brainstorm product solutions
                </li>
              </ul>
            </li>
            <li>
              <strong>Project managers</strong>
              <ul>
                <li>To lead and organize project efforts and run sprints</li>
              </ul>
            </li>
            <li>
              <strong>Developers</strong>
              <ul>
                <li>
                  To work with product managers, designers, and AI tools to
                  bring some amazing new things to life
                </li>
              </ul>
            </li>
            <li>
              <strong>
                Connectors, people with an audience, and subject-matter experts
              </strong>
              <ul>
                <li>
                  To help us with targeted community outreach, general outreach,
                  social media, and to give takes to product managers and
                  designers
                </li>
              </ul>
            </li>
            <li>
              <strong>Promotion people</strong>
              <ul>
                <li>
                  To help us spread awareness of the site and each resource page
                  in various ways, maybe including SEO
                </li>
              </ul>
            </li>
            <li>
              <strong>Anything else</strong>
              <ul>
                <li>Just tell us how you can help!</li>
              </ul>
            </li>
          </ul>

          <p className="color-teal-300 padding-bottom-40px">
            On the first day of the hackathon we will divide everyone into small
            teams by{' '}
            <a
              href="https://app.notion.com/p/15aaef8c3f9640018d6b256d39b4ee8a?pvs=21"
              target="_blank"
              rel="noopener noreferrer"
              className="color-light-teal"
            >
              project
            </a>
            . Participants will get to decide which projects they work on and in
            what way they contribute. We&apos;re also open to new project
            suggestions.
          </p>

          <h3 className="padding-bottom-16px">Why it&apos;s worth it</h3>
          <ul
            className={`color-teal-300 padding-bottom-40px ${styles.bullets}`}
          >
            <li>
              <strong>
                Build your resume, gain career capital, and make connections
              </strong>{' '}
              (everyone at the EA hotel, beyond just our hackathon, is working
              on something high-impact – mostly AI safety)
            </li>
            <li>
              <strong>Have fun</strong> beyond just the work. We&apos;ll set
              aside time each day for beach walks, games, etc.
            </li>
            <li>
              <strong>Help save the world!</strong>
            </li>
          </ul>

          <p className="color-teal-300 padding-bottom-40px">
            If you have any questions, please message Bryce on the{' '}
            <a
              href="https://discord.gg/WQG8FAGqun"
              target="_blank"
              rel="noopener noreferrer"
              className="color-light-teal"
            >
              AISafety.com Discord server
            </a>{' '}
            at @bryceerobertson, or email{' '}
            <a
              href="mailto:bryceerobertson@gmail.com"
              className="color-light-teal"
            >
              bryceerobertson@gmail.com
            </a>
            .
          </p>
        </div>

        <div className={styles.sticky}>
          <ApplicationForm />
        </div>
      </div>
    </div>
  )
}
