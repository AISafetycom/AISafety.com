/** The public listing policy ("What we list on AISafety.com"), as Markdown.
 *  Rendered at /listing-policy and given to the chatbot so it can tell whether
 *  a suggestion would qualify before offering a suggest form.
 *
 *  Canonical copy: ~/Comb/listing-policy.md (it also builds the PDF). When the
 *  policy changes there, paste the new text here. Supported Markdown: #, ##,
 *  ### headings, paragraphs, "- " bullets, **bold** and [links](url). */
export const LISTING_POLICY_MD = String.raw`# What we list on AISafety.com

If we declined a suggestion of yours, or you're wondering whether to send one, this is how we decide.

**A note before you read.** This page is a work in progress. Claude drafted it based on an analysis of what the humans running the site have chosen to accept and decline. Fundamentally, we're trying to reduce the chance of us all dying, and this is our best attempt at drawing the lines that serve that. Our policies will continue to be refined with time.

## What do you mean by "AI safety"?

[Existential or catastrophic risk from AI](https://en.wikipedia.org/wiki/Existential_risk_from_artificial_intelligence), x-risk for short. So the one question, on every page:

**Is this addressing x-risk from AI – above all, x-risk from artificial superintelligence?**

"AI safety adjacent" isn't enough. Listing everything calling itself AI safety would make a much bigger site, and the x-risk slice is what makes this one useful. The work itself settles the topic question, whoever runs or funds it.

Exclusivity isn't required. A significant part of what you do is enough. We judge recent public output (research, events, grants, legislation, talks). A mission line or plans don't count for much, and internal activity on its own isn't enough.

We lean toward work relevant to superintelligence, since we consider this to be the biggest threat. Something serious there clears the bar more easily, and a close call gets the benefit of the doubt.

## What counts and what doesn't?

### Counts

- Technical and theoretical alignment research, S-risk from AI, and gradual disempowerment worked on as a safety problem.
- Governance aimed at catastrophic or frontier AI risk, held to the same content test as technical work: red lines, compute governance, frontier oversight, loss of control, concentration of power, international agreements, model-weight security.
- Security of frontier AI itself: protecting model weights, hardware security, and verification for compute that others run. Enterprise and product security don't count.
- Major rationalist programs and content.
- Cause-general effective altruism orgs, events, and programs that address AI x-risk among their causes.
- Substantive single-author resources on superintelligence alignment. "Personal project" only counts against hobby-scale work.
- Non-English resources that explicitly cover existential risk.

### Out of scope here, whoever hosts it

These are real problems, they're just not what this site covers:

- Bias and fairness, deepfakes, misinformation and AI persuasion, content moderation, surveillance, privacy and civil liberties, child safety, copyright, job displacement and the economic impact of AI, AI for good, and AI literacy about near-term harms.
- AI welfare, digital minds, AI consciousness, AI and animals.
- General AI policy, AI diplomacy, and great-power competition or export controls framed as geopolitics.
- Tracking AI capabilities or the economics of AI without any safety work.
- Enterprise AI security, AI for cybersecurity, adversarial ML without a safety motivation, and general tech, startup, or venture activity.
- Biosecurity where the interventions are more bio than AI.
- Anything that isn't particularly useful for a reader to be aware of.

Advancing capabilities counts against a listing. The map shows the major AI companies under their own capabilities category so readers can see the whole field, but capabilities work doesn't earn a new listing: an organization that trains and ships frontier-style models is usually not a fit, even with a safety angle, and building, operating, or supplying compute is capabilities work.

## What's the bar for the page I submitted to?

Each page adds its own bar, and seriousness is a separate gate: on topic isn't the same as ready.

**/map** – the field map of key organizations, programs, and projects.
- The bar is higher here than for any of our other pages.
- For a young organization, a substantive first piece of work and ties to the field (collaborators, funders, or uptake of its work) may be enough.
- A one-person effort can be listed as a resource if the work is substantial.
- Too narrow a focus fails: a campaign for one plan, a project built around one named system, or an organization whose whole mission is one country's public or policymakers. A research organization with one focused agenda is fine though. There are 200 countries, so exceptions are possible only for the ones that matter most for frontier AI, such as the USA, China, and the UK. National groups belong on /communities.
- New podcasts, blogs, and newsletters go on /media-channels; only the key ones go on the map.

**/events** – conferences, workshops, talks, meetups, hackathons, and competitions.
- General effective altruism conferences are listed.
- Rationalist and forecasting community conferences are listed when a good share of the program is x-risk people, even if the page never says AI safety. A festival where x-risk is a handful of sessions among many isn't.
- A listed community's talk is fine if it's about x-risk, and a meetup around an off-topic talk isn't.
- We also weigh what the speaker actually works on. If their work is in an out-of-scope field (AI ethics, AI welfare) and the event page only hints at x-risk, the talk is out.
- A social counts when it exists so the AI safety community can connect. An event that mainly promotes the host organization (an anniversary or launch party, for example) doesn't, and neither does a session that is mostly the host explaining its own stance, strategy, or theory of change.
- One-off networking or panel events about AI safety are fine even when business or investor oriented.
- Side events of an already-listed conference are generally out.
- An event needs a date. An announced event with no date yet is too early.
- The event's own page needs to be finished. A placeholder page ("more info coming", a one-line description) isn't ready to list. Suggest it again once the page is done.
- Protests: a movement's major or coordinated protests are listed, not a local chapter's own small protest.
- A community's first meetup can be listed. Its later meetups and socials are covered by the community's own listing.
- We also look at the care in an event's own materials – wrong or inconsistent details count against it, and an informal event from a group we don't already list has more to prove.

**/training** – fellowships, courses, bootcamps, immersive workshops.
- If it's really a job (salary, a manager, open-ended), it belongs on /jobs, not here.
- Expression-of-interest programs are too early.
- So is a program with no dates yet. A confirmed cohort whose applications open later can be listed, but only once it has a start date, an end date, or an application deadline.
- Individual projects or streams within a larger program aren't listed, only the round itself.
- Rationalist or effective altruism programs that aren't labeled AI safety can be listed if the link to the field is real.
- Standing programs live under the Recurring tab, but each new cohort generally still gets its own dated listing. Courses that re-run every few weeks are the exception: only the first cohort gets a dated listing, and the Recurring entry covers the rest.

**/funding** – funders, grant programs, and funding platforms.
- The funder must explicitly and demonstrably fund AI x-risk work. Theoretical openness doesn't count, so general funders are out, though their dedicated safety programs are listed.
- Cash only, no API credits or compute.
- Fellowships where you do the work as part of a program go on /training. A grant-style one (a stipend, no employer) can go here.
- Funders that are closed for now or invitation-only stay on the page, flagged as not accepting.

**/communities** – local and online groups people can join.
- A group needs its own joinable space (e.g. a channel in someone else's server doesn't count).
- The main question is whether the group addresses x-risk: a multi-cause group where x-risk is only a sliver doesn't clear it.
- Being new isn't held against you, nor is being national.
- We look for x-risk activity people can see and join (public events, an open reading group, an active discussion space) and a home they can find. A group whose only footprint is a few event pages and a LinkedIn page is marginal but likely to be accepted.
- A listed network's chapters are covered by the parent listing.
- Coworking hubs go here, not on /map, although one that also runs its own programs can earn a /map entry too.

**/self-study** – courses, curricula, guides, and reading lists built to teach.
- A survey of the field or a research agenda isn't a learning resource.
- Jailbreak and adversarial-ML material is borderline.
- It has to be current, and we usually don't add near-duplicates of existing listings.

**/media-channels** – blogs, newsletters, podcasts, YouTube channels, forums, Twitter/X lists, books, and a few standalone articles.
- AI safety has to be a substantial, recurring focus.
- Blogs and newsletters also need some signal of significance e.g. a recognized author or organization, or a reasonable-sized audience (hundreds of subscribers, not dozens).
- An organization's own newsletter or feed isn't a media channel, especially when the organization is already listed. Essays instead of announcements don't change that unless the publication stands apart as its own product.
- A feed of teasers pointing at writing elsewhere isn't listed.
- Standalone articles are rare: only canonical, evergreen introductions make it.

**/founders** – incubators, accelerators, fiscal sponsors, venture funds, and tools for starting an AI safety organization.
- Cause-general ones qualify if the organization addresses AI x-risk.

**/advisors** – advising services: mostly career and contribution advice, plus some coaching and operational support.

**/projects** – volunteer projects for the AI safety community, including project ideas looking for an owner.
- The bar is lower here than on any other page. An early-stage project or an unstarted idea is fine, as long as it's a specific piece of work for AI safety with a real ask for volunteers or an owner.

**/jobs** – synced from the 80,000 Hours job board.
- Vacancies only, internships included: roles tagged as fellowship, course, funding, or volunteering are not listed.
- Submit roles to 80,000 Hours directly, using their [Propose a vacancy](https://jobs.80000hours.org/submit-role) form.

**/donation-guide** – a curated guide with no listings.

## Why is X listed when mine isn't?

Sometimes that's a fair point.

- Bars differ by page. A young organization can be on /communities long before it clears /map, and an organization that isn't on /map can still have its programs, events, or grants listed.
- Many calls are close.
- Some listings predate today's bar, which keeps sharpening.
- A few are deliberate one-off exceptions.
- We make mistakes. We're a small nonprofit with 1.25 salaried employees.

An existing listing isn't a guarantee, and we review and remove listings often.

## What can I do now?

- **Resubmit when things change** via the page's "Suggest listing" button. If the decline was about focus, point us at the output that shows it.
- **Tell us if we misread you.** If we missed x-risk work on your site or picked the wrong page, show us where. Reply to our email or use the "Send us an email" button.
- **Suggest a correction.** If you think another listing shouldn't be there, use "Suggest correction" on that page and say why.

Last updated: 25 September 2026
`
