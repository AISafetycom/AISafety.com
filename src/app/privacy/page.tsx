import Link from 'next/link'
import AnalyticsOptOut from './AnalyticsOptOut'

export const metadata = {
  title: 'Privacy – AISafety.com',
  description:
    'What AISafety.com collects, why, and the choices you have. No cookies, no ads, no selling data.',
  alternates: { canonical: '/privacy' },
}

export default function PrivacyPage() {
  return (
    <div className="container-narrow privacy-page">
      <div className="flex justify-center">
        <div className="width-9-col-narrow">
          <h1 className="padding-top-56px padding-bottom-40px">Privacy</h1>

          <h2 className="padding-bottom-56px">
            We collect{' '}
            <span className="color-teal-300">as little as we can</span>, and we
            don&apos;t use any of it for advertising or sell it to anyone. This
            page explains what we do collect, why, and the choices you have.
          </h2>

          <h3 className="padding-bottom-16px">Who we are</h3>
          <p className="color-teal-grey-300 padding-bottom-40px">
            AISafety.com is run by a small nonprofit team – you can meet us on
            the{' '}
            <Link href="/about" className="link">
              about page
            </Link>
            . Bryce Robertson, the site&apos;s project manager, is responsible
            for how visitor data is handled. For anything privacy-related,{' '}
            <a
              href="https://airtable.com/appF8XfZUGXtfi40E/pagUmmzVb8OnVvTZS/form"
              target="_blank"
              rel="noopener noreferrer"
              className="link"
            >
              send us a message
            </a>
            .
          </p>

          <h3 className="padding-bottom-16px">No cookies</h3>
          <p className="color-teal-grey-300 padding-bottom-40px">
            This site doesn&apos;t set cookies for visitors. The only cookie we
            use anywhere is the one our own team gets when signing in to the
            site&apos;s admin area. The site does keep three small things in
            your browser&apos;s own storage: your chatbot conversation, so it
            isn&apos;t lost as you move between pages; a note of whether your
            visit is one of the recorded sample described below (both are
            cleared when you close the tab); and the anonymous analytics ID
            described below, which you can switch off. Nothing in your browser
            is used for advertising or to track you across other sites – the
            things cookie banners exist to ask consent for – which is why
            there&apos;s no banner.
          </p>

          <h3 className="padding-bottom-16px">Analytics</h3>
          <p className="color-teal-grey-300 padding-bottom-24px">
            We use two privacy-respecting tools to understand how the site is
            used (and therefore improve it). Matomo, running in cookieless mode,
            gives us anonymous, aggregated statistics like page views and
            referrers. Our own first-party analytics records page visits, clicks
            on listings and links, what you search for on the site, and when the
            chatbot gets opened; it stores a random ID in your browser&apos;s
            local storage so we can count unique visitors, but that ID is not
            tied to your name, email, or IP address, and it never follows you to
            other sites.
          </p>
          <p className="color-teal-grey-300 padding-bottom-24px">
            We also record a sample of visits that reach a few of the main pages
            – how the site changes as you scroll, move the mouse, and click – to
            see where it&apos;s confusing. Anything you type is hidden in these
            recordings.
          </p>
          <p className="color-teal-grey-300 padding-bottom-24px">
            If you&apos;d rather not be counted, you can switch analytics off
            for this browser. This also stops your visits from being recorded
            and your chatbot conversations from being saved.
          </p>
          <AnalyticsOptOut />

          <h3 className="padding-bottom-16px">The chatbot</h3>
          <p className="color-teal-grey-300 padding-bottom-16px">
            The chatbot is powered by Claude, an AI model from Anthropic – your
            messages are sent to Anthropic to generate each reply, and Anthropic
            doesn&apos;t train its models on them. Conversations are saved so we
            can improve the chatbot – the messages, the page you were on, how
            you arrived at the site, and your approximate location (city and
            country, estimated from your IP address, which we don&apos;t keep).
            Conversations may be reviewed by the AISafety.com team and trusted
            partners, and we use Claude to summarize the common topics people
            ask about. You&apos;ll see a notice about this in the chat window
            before you type anything. Please don&apos;t share sensitive personal
            information in the chat, and if you&apos;d like a conversation
            deleted, contact us using the form below.
          </p>
          <p className="color-teal-grey-300 padding-bottom-40px">
            If you attach a document, your browser reads it and sends only its
            text, which goes to Anthropic along with your message. The file
            itself never leaves your computer, and the saved conversation keeps
            only the file&apos;s name and length, not its text. If you use the
            microphone button, your browser turns your speech into text – the
            audio goes to the company that makes your browser (Google, Apple, or
            Microsoft) and never to us.
          </p>

          <h3 className="padding-bottom-16px">Newsletters</h3>
          <p className="color-teal-grey-300 padding-bottom-40px">
            When you sign up for the AI Safety Events, AI Safety Training, AI
            Safety Funding, or AISafety.com Updates newsletter on this site,
            your email address goes to ActiveCampaign, the service that sends
            them, and you&apos;re subscribed right away and get a welcome email.
            If you subscribed to the AI Safety Events &amp; Training, the AI
            Safety Funding, or the AISafety.com Updates newsletter on Substack,
            your email address moved to ActiveCampaign with the newsletter in
            2026. ActiveCampaign records, for each reader, which emails they
            open and when they unsubscribe. When you click a link in one of
            those emails, the click is counted by aisafety.com itself,
            anonymously – it isn&apos;t tied to you or your email address. Every
            email has an unsubscribe link at the bottom, and a Manage
            subscriptions link that opens your newsletters on{' '}
            <Link href="/newsletter" className="link">
              aisafety.com/newsletter
            </Link>{' '}
            so you can change which ones you get; the private code in that link
            stays out of our analytics. When you sign up for several newsletters
            there at once, one welcome email covers them all. Issues from before
            the newsletters moved are still on Substack, where Substack&apos;s
            own privacy policy applies.
          </p>

          <h3 className="padding-bottom-16px">Services we rely on</h3>
          <p className="color-teal-grey-300 padding-bottom-40px">
            The site runs on Vercel (hosting), Matomo Cloud (analytics),
            Airtable (our listings database, forms, and chatbot logs), Anthropic
            (Claude, the AI model behind the chatbot), ipapi.co (the
            approximate-location lookup for chatbot conversations),
            ActiveCampaign (the newsletters), and Substack (the
            newsletters&apos; issues from before they moved).
          </p>

          <h3 className="padding-bottom-16px">Your choices</h3>
          <p className="color-teal-grey-300 padding-bottom-40px">
            You can ask us what data we hold about you, or ask us to correct or
            delete it, by{' '}
            <a
              href="https://airtable.com/appF8XfZUGXtfi40E/pagUmmzVb8OnVvTZS/form"
              target="_blank"
              rel="noopener noreferrer"
              className="link"
            >
              sending us a message
            </a>
            . Because our analytics is anonymous, the only things of yours
            we&apos;d be able to find are a chatbot conversation and, if you
            signed up for one of the newsletters, your subscription. For a
            conversation, mention roughly when it happened and what it was
            about, and we&apos;ll delete it.
          </p>

          <p className="paragraph-small color-teal-grey-300 padding-bottom-80px">
            Last updated: 26 November 2026
          </p>
        </div>
      </div>
    </div>
  )
}
