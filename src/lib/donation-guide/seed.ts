// The donation guide as it read on 15 September 2026, generated from the
// React components it used to live in (seed.generate.test.ts, in the git
// history). Version 0: what the page shows until the first publish, and
// what it falls back to if the store is ever unreachable.
import type { Guide } from './types'

export const SEED_GUIDE: Guide = {
  intro: {
    blocks: [
      {
        type: 'paragraph',
        inlines: [
          {
            text: 'This guide can help you determine the most effective way to ',
          },
          {
            text: 'financially support work on AI safety,',
            bold: true,
          },
          {
            text: ' given the funds and time you have available.',
          },
        ],
      },
    ],
  },
  tabs: [
    {
      id: 'tab1',
      amount: '$1–1,000',
      lead: 'AI safety is funding-limited at the moment and every bit counts.',
      sections: [
        {
          id: 'tab1-5-minutes-1-hour',
          time: '5 minutes–1 hour',
          body: {
            blocks: [
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'You can delegate to experienced grantmakers who know of more good opportunities than they can fund.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Donate to a fund, such as the ',
                  },
                  {
                    text: 'AI Risk Mitigation Fund',
                    href: 'https://www.airiskfund.com/',
                  },
                  {
                    text: '. Grantmakers evaluate projects on behalf of donors and choose the projects they think are most effective to fund. Alternatively, you can donate to a ',
                  },
                  {
                    text: 'donor lottery',
                    href: 'https://www.givingwhatwecan.org/donor-lottery',
                  },
                  {
                    text: ' which gives you a chance to direct a larger amount of money.',
                  },
                ],
              },
            ],
          },
        },
        {
          id: 'tab1-1-50-hours',
          time: '1–50 hours',
          body: {
            blocks: [
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'With some time, you might be able to find good opportunities yourself. Otherwise you can delegate to experienced grantmakers.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Either donate to a fund, such as the ',
                  },
                  {
                    text: 'AI Risk Mitigation Fund',
                    href: 'https://www.airiskfund.com/',
                  },
                  {
                    text: ', donate to a specific project that you think effectively tackles the issues of AI safety if you have one in mind, delegate to someone in your network if you know someone whose opinion in this area you trust, or send money via a ',
                  },
                  {
                    text: 'donor lottery',
                    href: 'https://www.givingwhatwecan.org/donor-lottery',
                  },
                  {
                    text: ' to give you a chance to direct a much larger amount and dedicate your time to researching where it should go.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'We recommend exploring ',
                  },
                  {
                    text: 'Manifund',
                    href: 'https://manifund.org/',
                  },
                  {
                    text: ', which allows you to "invest" in projects you think will be impactful, or nominate regrantors to decide on your behalf. ',
                  },
                  {
                    text: 'GiveWiki',
                    href: 'https://givewiki.org/',
                  },
                  {
                    text: ' and the ',
                  },
                  {
                    text: 'Nonlinear Network',
                    href: 'https://www.nonlinear.org/network.html',
                  },
                  {
                    text: ' are other platforms where you can choose projects to fund.',
                  },
                ],
              },
            ],
          },
        },
        {
          id: 'tab1-ongoing-commitment',
          time: 'Ongoing commitment',
          body: {
            blocks: [
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'By studying more before donating, you donate not just your money but your cognition to find and assess opportunities which big grantmakers – who have less time per unit of money – might miss.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Read up',
                    href: 'https://aisafety.info/',
                  },
                  {
                    text: ' to understand the problem, get involved in the ',
                  },
                  {
                    text: 'community',
                    href: '/communities',
                  },
                  {
                    text: ', and fund projects or individuals who you think are doing the best work.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Consider engaging with researchers in the comments sections of their research posts on ',
                  },
                  {
                    text: 'LessWrong',
                    href: 'https://www.lesswrong.com/w/ai',
                  },
                  {
                    text: '.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Either donate to a specific project that you think effectively tackles the issues of AI safety if you have one in mind, delegate to someone in your network if you know someone whose opinions in this area you trust, or send money via a ',
                  },
                  {
                    text: 'donor lottery',
                    href: 'https://www.givingwhatwecan.org/donor-lottery',
                  },
                  {
                    text: ' to give you a chance to direct a much larger amount and dedicate your time to researching where it should go.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'We recommend exploring ',
                  },
                  {
                    text: 'Manifund',
                    href: 'https://manifund.org/',
                  },
                  {
                    text: ', which allows you to "invest" in projects you think will be impactful, or nominate regrantors to decide on your behalf. ',
                  },
                  {
                    text: 'GiveWiki',
                    href: 'https://givewiki.org/',
                  },
                  {
                    text: ' and the ',
                  },
                  {
                    text: 'Nonlinear Network',
                    href: 'https://www.nonlinear.org/network.html',
                  },
                  {
                    text: ' are other platforms where you can choose projects to fund.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Donating to a fund such as the ',
                  },
                  {
                    text: 'AI Risk Mitigation Fund',
                    href: 'https://www.airiskfund.com/',
                  },
                  {
                    text: ' is a good fallback option.',
                  },
                ],
              },
            ],
          },
        },
        {
          id: 'tab1-major-focus',
          time: 'Major focus',
          body: {
            blocks: [
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'By studying more before you donate, you donate not just your money but your cognition to find and assess opportunities which big grantmakers – who have less time per unit of money – might miss.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Read up',
                    href: 'https://aisafety.info/',
                  },
                  {
                    text: ' to understand the problem, get involved in the ',
                  },
                  {
                    text: 'community',
                    href: '/communities',
                  },
                  {
                    text: ', and fund projects or individuals who you think are doing the best work.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Consider self-funding to try and ',
                  },
                  {
                    text: 'tackle the problem yourself',
                    href: 'https://aisafety.info/how-can-i-help',
                  },
                  {
                    text: ', either directly as a researcher or by using your existing skills to support the field.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Either donate to a specific project that you think effectively tackles the issues of AI safety if you have one in mind, delegate to someone in your network if you know someone whose opinions in this area you trust, or send money via a ',
                  },
                  {
                    text: 'donor lottery',
                    href: 'https://www.givingwhatwecan.org/donor-lottery',
                  },
                  {
                    text: ' to give you a chance to direct a much larger amount and dedicate your time to researching where it should go.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'We recommend exploring ',
                  },
                  {
                    text: 'Manifund',
                    href: 'https://manifund.org/',
                  },
                  {
                    text: ', which allows you to "invest" in projects you think will be impactful, or nominate regrantors to decide on your behalf. ',
                  },
                  {
                    text: 'GiveWiki',
                    href: 'https://givewiki.org/',
                  },
                  {
                    text: ' and the ',
                  },
                  {
                    text: 'Nonlinear Network',
                    href: 'https://www.nonlinear.org/network.html',
                  },
                  {
                    text: ' are other platforms where you can choose projects to fund.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Donating to a fund such as the ',
                  },
                  {
                    text: 'AI Risk Mitigation Fund',
                    href: 'https://www.airiskfund.com/',
                  },
                  {
                    text: ' is a good fallback option.',
                  },
                ],
              },
            ],
          },
        },
      ],
    },
    {
      id: 'tab2',
      amount: '$1,000–10,000',
      lead: 'AI safety is funding-limited at the moment and notable donations can make a big difference.',
      sections: [
        {
          id: 'tab2-5-minutes-1-hour',
          time: '5 minutes–1 hour',
          body: {
            blocks: [
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'You can delegate to experienced grantmakers who know of more good opportunities than they can fund.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Donate to a fund, such as the ',
                  },
                  {
                    text: 'AI Risk Mitigation Fund',
                    href: 'https://www.airiskfund.com/',
                  },
                  {
                    text: '. Grantmakers evaluate projects on behalf of donors and choose the projects they think are most effective to fund.',
                  },
                ],
              },
            ],
          },
        },
        {
          id: 'tab2-1-50-hours',
          time: '1–50 hours',
          body: {
            blocks: [
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'With some time, you might be able to find good opportunities yourself, otherwise you can delegate to experienced grantmakers.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Either donate to a fund, such as the ',
                  },
                  {
                    text: 'AI Risk Mitigation Fund',
                    href: 'https://www.airiskfund.com/',
                  },
                  {
                    text: ', donate to specific projects that you think effectively tackle the issues of AI safety if you have some in mind, delegate to someone in your network if you know someone whose opinions in this area you trust, or send money via a ',
                  },
                  {
                    text: 'donor lottery',
                    href: 'https://www.givingwhatwecan.org/donor-lottery',
                  },
                  {
                    text: ' to give you a chance to direct a much larger amount and dedicate your time to researching where it should go.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'We recommend exploring ',
                  },
                  {
                    text: 'Manifund',
                    href: 'https://manifund.org/',
                  },
                  {
                    text: ', which allows you to "invest" in projects you think will be impactful, or nominate regrantors to decide on your behalf. ',
                  },
                  {
                    text: 'GiveWiki',
                    href: 'https://givewiki.org/',
                  },
                  {
                    text: ' and the ',
                  },
                  {
                    text: 'Nonlinear Network',
                    href: 'https://www.nonlinear.org/network.html',
                  },
                  {
                    text: ' are other platforms where you can choose projects to fund.',
                  },
                ],
              },
            ],
          },
        },
        {
          id: 'tab2-ongoing-commitment',
          time: 'Ongoing commitment',
          body: {
            blocks: [
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'By studying more before donating, you donate not just your money but your cognition to find and assess opportunities which big grantmakers – who have less time per unit of money – might miss.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Read up',
                    href: 'https://aisafety.info/',
                  },
                  {
                    text: ' to understand the problem, get involved in the ',
                  },
                  {
                    text: 'community',
                    href: '/communities',
                  },
                  {
                    text: ', and fund projects or individuals who you think are doing the best work.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Consider engaging with researchers in the comments sections of their research posts on ',
                  },
                  {
                    text: 'LessWrong',
                    href: 'https://www.lesswrong.com/w/ai',
                  },
                  {
                    text: '.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Either donate to a specific project that you think effectively tackles the issues of AI safety if you have one in mind, delegate to someone in your network if you know someone whose opinions in this area you trust, or send money via a ',
                  },
                  {
                    text: 'donor lottery',
                    href: 'https://www.givingwhatwecan.org/donor-lottery',
                  },
                  {
                    text: ' to give you a chance to direct a much larger amount and dedicate your time to researching where it should go.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'We recommend exploring ',
                  },
                  {
                    text: 'Manifund',
                    href: 'https://manifund.org/',
                  },
                  {
                    text: ', which allows you to "invest" in projects you think will be impactful, or nominate regrantors to decide on your behalf. ',
                  },
                  {
                    text: 'GiveWiki',
                    href: 'https://givewiki.org/',
                  },
                  {
                    text: ' and the ',
                  },
                  {
                    text: 'Nonlinear Network',
                    href: 'https://www.nonlinear.org/network.html',
                  },
                  {
                    text: ' are other platforms where you can choose projects to fund.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Donating to a fund such as the ',
                  },
                  {
                    text: 'AI Risk Mitigation Fund',
                    href: 'https://www.airiskfund.com/',
                  },
                  {
                    text: ' is a good fallback option.',
                  },
                ],
              },
            ],
          },
        },
        {
          id: 'tab2-major-focus',
          time: 'Major focus',
          body: {
            blocks: [
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'By studying more before you donate, you donate not just your money but your cognition to find and assess opportunities which big grantmakers – who have less time per unit of money – might miss.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Read up',
                    href: 'https://aisafety.info/',
                  },
                  {
                    text: ' to understand the problem, get involved in the ',
                  },
                  {
                    text: 'community',
                    href: '/communities',
                  },
                  {
                    text: ', and fund projects or individuals who you think are doing the best work.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Consider self-funding to try and ',
                  },
                  {
                    text: 'tackle the problem yourself',
                    href: 'https://aisafety.info/how-can-i-help',
                  },
                  {
                    text: ', either directly as a researcher or by using your existing skills to support the field.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Either donate to a specific project that you think effectively tackles the issues of AI safety if you have one in mind, delegate to someone in your network if you know someone whose opinions in this area you trust, or send money via a ',
                  },
                  {
                    text: 'donor lottery',
                    href: 'https://www.givingwhatwecan.org/donor-lottery',
                  },
                  {
                    text: ' to give you a chance to direct a much larger amount and dedicate your time to researching where it should go.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'We recommend exploring ',
                  },
                  {
                    text: 'Manifund',
                    href: 'https://manifund.org/',
                  },
                  {
                    text: ', which allows you to "invest" in projects you think will be impactful, or nominate regrantors to decide on your behalf. ',
                  },
                  {
                    text: 'GiveWiki',
                    href: 'https://givewiki.org/',
                  },
                  {
                    text: ' and the ',
                  },
                  {
                    text: 'Nonlinear Network',
                    href: 'https://www.nonlinear.org/network.html',
                  },
                  {
                    text: ' are other platforms where you can choose projects to fund.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Donating to a fund such as the ',
                  },
                  {
                    text: 'AI Risk Mitigation Fund',
                    href: 'https://www.airiskfund.com/',
                  },
                  {
                    text: ' is a good fallback option.',
                  },
                ],
              },
            ],
          },
        },
      ],
    },
    {
      id: 'tab3',
      amount: '$10,000–100,000',
      lead: 'At this scale of donation, you could enable grantmakers to support someone working on AI safety full-time, or provide significant support to an organization.',
      sections: [
        {
          id: 'tab3-5-minutes-1-hour',
          time: '5 minutes–1 hour',
          body: {
            blocks: [
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Donate to a fund, such as the ',
                  },
                  {
                    text: 'AI Risk Mitigation Fund',
                    href: 'https://www.airiskfund.com/',
                  },
                  {
                    text: '. Grantmakers evaluate projects on behalf of donors and choose the projects they think are most effective to fund.',
                  },
                ],
              },
            ],
          },
        },
        {
          id: 'tab3-1-50-hours',
          time: '1–50 hours',
          body: {
            blocks: [
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Either donate to a fund, such as the ',
                  },
                  {
                    text: 'AI Risk Mitigation Fund',
                    href: 'https://www.airiskfund.com/',
                  },
                  {
                    text: ', donate to specific projects that you think effectively tackle the issues of AI safety if you have some in mind, delegate to someone in your network if you know someone whose opinions in this area you trust, or send money via a ',
                  },
                  {
                    text: 'donor lottery',
                    href: 'https://www.givingwhatwecan.org/donor-lottery',
                  },
                  {
                    text: ' to give you a chance to direct a much larger amount and dedicate your time to researching where it should go.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'We recommend exploring ',
                  },
                  {
                    text: 'Manifund',
                    href: 'https://manifund.org/',
                  },
                  {
                    text: ', which allows you to "invest" in projects you think will be impactful, or nominate regrantors to decide on your behalf. ',
                  },
                  {
                    text: 'GiveWiki',
                    href: 'https://givewiki.org/',
                  },
                  {
                    text: ' and the ',
                  },
                  {
                    text: 'Nonlinear Network',
                    href: 'https://www.nonlinear.org/network.html',
                  },
                  {
                    text: ' are other platforms where you can choose projects to fund.',
                  },
                ],
              },
            ],
          },
        },
        {
          id: 'tab3-ongoing-commitment',
          time: 'Ongoing commitment',
          body: {
            blocks: [
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Read up',
                    href: 'https://aisafety.info/',
                  },
                  {
                    text: ' to understand the problem, get involved in the ',
                  },
                  {
                    text: 'community',
                    href: '/communities',
                  },
                  {
                    text: ', and fund projects or individuals who you think are doing the best work.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Consider engaging with researchers in the comments sections of their research posts on ',
                  },
                  {
                    text: 'LessWrong',
                    href: 'https://www.lesswrong.com/w/ai',
                  },
                  {
                    text: '.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Donating to a fund such as the ',
                  },
                  {
                    text: 'AI Risk Mitigation Fund',
                    href: 'https://www.airiskfund.com/',
                  },
                  {
                    text: ' is a good fallback option.',
                  },
                ],
              },
            ],
          },
        },
        {
          id: 'tab3-major-focus',
          time: 'Major focus',
          body: {
            blocks: [
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Read up',
                    href: 'https://aisafety.info/',
                  },
                  {
                    text: ' to understand the problem, get involved in the ',
                  },
                  {
                    text: 'community',
                    href: '/communities',
                  },
                  {
                    text: ', and fund projects or individuals who you think are doing the best work.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Consider self-funding to try and tackle the problem yourself, either directly as a researcher or by using your existing skills to support the field.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Donating to a fund such as the ',
                  },
                  {
                    text: 'AI Risk Mitigation Fund',
                    href: 'https://www.airiskfund.com/',
                  },
                  {
                    text: ' is a good fallback option.',
                  },
                ],
              },
            ],
          },
        },
      ],
    },
    {
      id: 'tab4',
      amount: '$100,000+',
      lead: 'You can provide significant support to several organizations, and could also support many full-time researchers. The total funding for AI safety was around $150 million in 2023; you can be a notable fraction of the funding ecosystem if you care and can dedicate the funds.',
      sections: [
        {
          id: 'tab4-5-minutes-1-hour',
          time: '5 minutes–1 hour',
          body: {
            blocks: [
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Either delegate to someone in your network who you think has a good understanding of the challenge (possibly by sponsoring them as an ',
                  },
                  {
                    text: 'S-process recommender',
                    href: 'https://survivalandflourishing.fund/s-process.html',
                  },
                  {
                    text: ', which will give them infrastructure and a menu of applications), or donate to a fund such as the ',
                  },
                  {
                    text: 'AI Risk Mitigation Fund',
                    href: 'https://www.airiskfund.com/',
                  },
                  {
                    text: ' where grantmakers evaluate projects on behalf of donors.',
                  },
                ],
              },
            ],
          },
        },
        {
          id: 'tab4-1-50-hours',
          time: '1–50 hours',
          body: {
            blocks: [
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Some high impact ideas include sponsoring an ',
                  },
                  {
                    text: 'S-process recommender',
                    href: 'https://survivalandflourishing.fund/s-process.html',
                  },
                  {
                    text: ' whose judgment you trust, which will give them infrastructure and a menu of applications, or donate to a ',
                  },
                  {
                    text: 'donor lottery',
                    href: 'https://www.givingwhatwecan.org/donor-lottery',
                  },
                  {
                    text: ' which can amplify your donation.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Alternatively, either donate to a fund – such as the ',
                  },
                  {
                    text: 'AI Risk Mitigation Fund',
                    href: 'https://www.airiskfund.com/',
                  },
                  {
                    text: ' – or to specific projects that you think effectively tackle the issues of AI safety, or select individuals to donate to directly. We recommend exploring ',
                  },
                  {
                    text: 'Manifund',
                    href: 'https://manifund.org/',
                  },
                  {
                    text: ', which allows you to "invest" in projects you think will be impactful, or nominate regrantors to decide on your behalf. ',
                  },
                  {
                    text: 'GiveWiki',
                    href: 'https://givewiki.org/',
                  },
                  {
                    text: ' and the ',
                  },
                  {
                    text: 'Nonlinear Network',
                    href: 'https://www.nonlinear.org/network.html',
                  },
                  {
                    text: ' are similar platforms where you can choose projects to fund.',
                  },
                ],
              },
            ],
          },
        },
        {
          id: 'tab4-ongoing-commitment',
          time: 'Ongoing commitment',
          body: {
            blocks: [
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Read up',
                    href: 'https://aisafety.info/',
                  },
                  {
                    text: ' to understand the problem, get involved in the ',
                  },
                  {
                    text: 'community',
                    href: '/communities',
                  },
                  {
                    text: ', and fund projects or individuals who you think are doing the best work.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Consider engaging with researchers in the comments sections of their research posts on ',
                  },
                  {
                    text: 'LessWrong',
                    href: 'https://www.lesswrong.com/w/ai',
                  },
                  {
                    text: '.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Alternatively, either donate to a fund – such as the ',
                  },
                  {
                    text: 'AI Risk Mitigation Fund',
                    href: 'https://www.airiskfund.com/',
                  },
                  {
                    text: ' – or to specific projects that you think effectively tackle the issues of AI safety, or select individuals to donate to directly. We recommend exploring ',
                  },
                  {
                    text: 'Manifund',
                    href: 'https://manifund.org/',
                  },
                  {
                    text: ', which allows you to "invest" in projects you think will be impactful.',
                  },
                ],
              },
            ],
          },
        },
        {
          id: 'tab4-major-focus',
          time: 'Major focus',
          body: {
            blocks: [
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Read up',
                    href: 'https://aisafety.info/',
                  },
                  {
                    text: ' to understand the problem, get involved in the ',
                  },
                  {
                    text: 'community',
                    href: '/communities',
                  },
                  {
                    text: ', and fund projects or individuals who you think are doing the best work.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Consider self-funding to try and tackle the problem yourself, either directly as a researcher or by using your existing skills to support the field. You can also skill up to improve your abilities as a grantmaker.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Consider engaging with researchers in the comments sections of their research posts on ',
                  },
                  {
                    text: 'LessWrong',
                    href: 'https://www.lesswrong.com/w/ai',
                  },
                  {
                    text: '.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Some high impact ideas for donating include sponsoring an ',
                  },
                  {
                    text: 'S-process recommender',
                    href: 'https://survivalandflourishing.fund/s-process.html',
                  },
                  {
                    text: ' whose judgment you trust, which will give them infrastructure and a menu of applications, or donate to a ',
                  },
                  {
                    text: 'donor lottery',
                    href: 'https://www.givingwhatwecan.org/donor-lottery',
                  },
                  {
                    text: ' which can amplify your donation.',
                  },
                ],
              },
              {
                type: 'paragraph',
                inlines: [
                  {
                    text: 'Alternatively, either donate to a fund – such as the ',
                  },
                  {
                    text: 'AI Risk Mitigation Fund',
                    href: 'https://www.airiskfund.com/',
                  },
                  {
                    text: ' – or to specific projects that you think effectively tackle the issues of AI safety, or select individuals to donate to directly. We recommend exploring ',
                  },
                  {
                    text: 'Manifund',
                    href: 'https://manifund.org/',
                  },
                  {
                    text: ', which allows you to "invest" in projects you think will be impactful.',
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  ],
}
