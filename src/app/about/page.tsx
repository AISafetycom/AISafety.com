import Image from 'next/image'
import Link from 'next/link'
import Icon from '@/components/Icon'
import styles from './page.module.css'

export const metadata = {
  title: 'About – AISafety.com',
  description:
    'We aim to provide a central and comprehensive hub for AI safety, through which individuals can easily discover the most impactful resources for them.',
  alternates: { canonical: '/about' },
}

export default function AboutPage() {
  return (
    <div className="container-narrow">
      <h1 className="padding-top-56px padding-bottom-40px">About us</h1>

      <h2 className="width-9-col-narrow padding-bottom-56px">
        We&apos;re a small nonprofit driven by 1.25 salaried employees and lots
        of volunteers. We aim to multiply global AI safety efforts through a{' '}
        <span className="color-light-teal">
          centralized, comprehensive, and up-to-date resource hub
        </span>
        .
      </h2>

      <div className="flex gap-56px flex-col-mobile">
        {/* Left column — text sections */}
        <div className="width-7-col-narrow">
          <div>
            <h3 className="padding-bottom-16px">Funding</h3>
            <p className="color-teal-300 padding-bottom-40px">
              This project operates on about $100k USD of annual funding from
              the Survival and Flourishing Fund, a grantmaker that supports
              projects working on the long-term survival and flourishing of
              sentient life. This pays for 1 full-time and 1 part-time salary
              (everyone else is a volunteer) plus some other costs, like website
              hosting.
            </p>

            <h3 className="padding-bottom-16px">
              (Lack of) financial motivations
            </h3>
            <p className="color-teal-300">
              We work on this project because we care about AI safety. The two
              team members that receive compensation make project decisions
              based solely on what they believe will have the greatest impact.
              This approach has proven to be totally aligned with our funders’
              goals.
            </p>
          </div>
        </div>

        {/* Right column — Questions card */}
        <div className={`${styles.questionsCard} width-5-col-narrow`}>
          <p className="color-white paragraph-default-bold">
            Get in touch with the team
          </p>
          <p className="color-teal-300 padding-top-16px paragraph-small">
            Whether it&apos;s a take, suggestion, request, or something else, we
            want to hear from you.
          </p>
          <div className="padding-top-24px">
            <a
              href="https://airtable.com/appF8XfZUGXtfi40E/pagUmmzVb8OnVvTZS/form"
              target="_blank"
              rel="noopener noreferrer"
              className="button-secondary"
            >
              Send us an email
            </a>
          </div>
          <p className="color-teal-300 padding-top-24px paragraph-small">
            Journalist? Boilerplate, logos and a press contact are on the{' '}
            <Link href="/media" className="color-light-teal">
              press and media page
            </Link>
            .
          </p>
        </div>
      </div>

      {/* Team section */}
      <h2
        id="team"
        className="padding-top-80px padding-bottom-56px width-7-col-narrow"
      >
        We consider AISafety.com a community project, led by a few core members.
      </h2>

      <div className="flex flex-col gap-56px">
        {/* Row 1 */}
        <div className="flex gap-56px flex-col-mobile">
          <div className="width-6-col-narrow">
            <div className="flex gap-16px items-center padding-bottom-24px">
              <Image
                src="/images/soeren.png"
                alt="Søren Elverlin"
                width={72}
                height={72}
              />
              <div>
                <p className="paragraph-default-bold padding-bottom-4px">
                  Søren Elverlin
                </p>
                <p className="paragraph-small color-teal-300">
                  Project lead, back-end development
                </p>
              </div>
            </div>
            <p className="paragraph-small color-teal-300 padding-bottom-16px">
              Søren read the Sequences in 2014 and set out to verify whether AI
              risk was real. He founded AI Safety Danmark in 2016, bought the
              AISafety.com domain the next year, and runs an AI safety reading
              group now past 300 meetings. As a father of two, protecting his
              family is his greatest motivation.
            </p>
          </div>

          <div className="width-6-col-narrow">
            <div className="flex gap-16px items-center padding-bottom-24px">
              <Image
                src="/images/bryce.png"
                alt="Bryce Robertson"
                width={72}
                height={72}
              />
              <div>
                <p className="paragraph-default-bold padding-bottom-4px">
                  Bryce Robertson
                </p>
                <p className="paragraph-small color-teal-300">
                  Project manager
                </p>
              </div>
            </div>
            <p className="paragraph-small color-teal-300 padding-bottom-16px">
              Bryce was blown away by GPT-4&apos;s capabilities when it was
              released in 2023, but quickly discovered that alongside its
              enormous potential, AI also poses an existential risk. He closed
              his video agency and pivoted his career to working full time on AI
              safety.
            </p>
          </div>
        </div>

        {/* Row 2 */}
        <div className="flex gap-56px flex-col-mobile">
          <div className="width-6-col-narrow">
            <div className="flex gap-16px items-center padding-bottom-24px">
              <Image
                src="/images/melissa.png"
                alt="Melissa Samworth"
                width={72}
                height={72}
              />
              <div>
                <p className="paragraph-default-bold padding-bottom-4px">
                  Melissa Samworth
                </p>
                <p className="paragraph-small color-teal-300">
                  Product design, front-end development
                </p>
              </div>
            </div>
            <p className="paragraph-small color-teal-300">
              Melissa got into AI safety in 2023 when she realized aligned
              superintelligence served the best shot at fulfilling the
              Buddhist-inspired mantra ‘may all sentient beings be free of
              suffering’. But future AI could go unimaginably well or
              unimaginably badly. She set out to help things go well.
            </p>
          </div>

          <div className="width-6-col-narrow">
            <div className="flex gap-16px items-center padding-bottom-24px">
              <Image src="/images/plex.png" alt="plex" width={72} height={72} />
              <div>
                <p className="paragraph-default-bold padding-bottom-4px">
                  plex
                </p>
                <p className="paragraph-small color-teal-300">
                  Founder and advisor
                </p>
              </div>
            </div>
            <p className="paragraph-small color-teal-300">
              plex has been working toward reducing existential risk from AI
              since 2015, building infrastructure like the original versions of
              the AISafety.com resources and{' '}
              <a
                href="https://aisafety.info"
                target="_blank"
                rel="noopener noreferrer"
                className="color-light-teal"
              >
                AISafety.info
              </a>{' '}
              before handing over the organization to focus on other projects.
              He wants to look back from futures where things go well and be
              proud of his efforts.
            </p>
          </div>
        </div>
      </div>

      {/* Volunteers & community section */}
      <div className="flex gap-56px padding-top-104px flex-col-mobile">
        <h3 className="width-4-col-narrow">
          30+ volunteers &amp; tons of takes from the community (thank you!)
        </h3>

        <div className="flex flex-col gap-56px width-4-col-narrow">
          <div>
            <div className={styles.iconCircle}>
              <Icon
                src="/images/icons/people.svg"
                size={16}
                className="color-teal-bright-300"
              />
            </div>
            <p className="paragraph-small color-teal-300 padding-top-24px padding-bottom-24px">
              Volunteers tend to contribute on a project-to-project basis,
              typically in the domains of development, design, and user
              research.
            </p>
            <a
              href="mailto:bryceerobertson@gmail.com?subject=Volunteering%20for%20AISafety.com"
              target="_blank"
              rel="noopener noreferrer"
              className="button-secondary"
            >
              Volunteer
            </a>
          </div>

          <div>
            <div className={styles.iconCircle}>
              <Icon
                src="/images/icons/speech-bubble.svg"
                size={16}
                className="color-teal-bright-300"
              />
            </div>
            <p className="paragraph-small color-teal-300 padding-top-24px padding-bottom-24px">
              We built this site for the AI safety community – and we&apos;re
              always looking to make it more useful. If you&apos;ve got
              thoughts, we&apos;re listening.
            </p>
            <a
              href="https://discord.gg/faamWzPcv8"
              target="_blank"
              rel="noopener noreferrer"
              className="button-secondary"
            >
              Give us your take
            </a>
          </div>
        </div>

        <div className="width-4-col-narrow">
          <div className={styles.iconCircle}>
            <Icon
              src="/images/icons/add-doc.svg"
              size={16}
              className="color-teal-bright-300"
            />
          </div>
          <p className="paragraph-small color-teal-300 padding-top-24px padding-bottom-24px">
            We encourage community members to add listings we may have missed
            through the ‘Suggest listing’ button on each resource page, or
            suggest corrections using the button below.
          </p>
          <a
            href="https://airtable.com/appF8XfZUGXtfi40E/pagndDvdya1DSqoxN/form"
            target="_blank"
            rel="noopener noreferrer"
            className="button-secondary"
          >
            Suggest a correction
          </a>
        </div>
      </div>
    </div>
  )
}
