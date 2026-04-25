function family(key, fromPool, subjectPool, paragraph1Pool, paragraph2Pool, signoffPool) {
  return { key, fromPool, subjectPool, paragraph1Pool, paragraph2Pool, signoffPool };
}

const internalOpsSignoffs = [
  'Thanks,\nOperations Team',
  'Regards,\nOperations Coordination',
  'Thanks,\nWorkflow Operations',
];

const internalSupportSignoffs = [
  'Thanks,\nSupport Team',
  'Regards,\nService Desk',
  'Thank you,\nPlatform Support',
];

const internalManagerSignoffs = [
  'Thanks,\nAdmin Desk',
  'Regards,\nOffice Coordination',
  'Thank you,\nWorkforce Operations',
];

const scamSignoffs = [
  'Regards,\nVerification Team',
  'Thank you,\nAccount Services',
  'Sincerely,\nSecurity Operations',
  'Thanks,\nPortal Support',
];

const spamSignoffs = [
  'Cheers,\nPromotions Team',
  'Best,\nMember Rewards',
  'Thanks,\nCustomer Offers Desk',
];

module.exports = {
  title: '📧 Email Sorter',
  footer: 'Read carefully. One bad phishing call can wreck the shift.',
  description: 'Sort each incoming email into the correct folder before the queue backs up.',

  emailsPerRun: 3,
  guaranteedScamEmailsPerRun: 1,
  cooldownSeconds: 8 * 60,

  xp: {
    success: 16,
    partial: 9,
    fail: 4,
  },

  payout: {
    runCompletion: { min: 750, max: 1500 },
    correctEmail: { min: 1000, max: 2000 },
    perfectBonusPct: 0,
    scamInSpamPenalty: { min: 180, max: 360 },
  },

  failureRules: {
    missionFailOnScamIn: ['urgent', 'todo'],
  },

  generation: {
    weights: {
      urgent: 22,
      todo: 28,
      spam: 20,
      scam: 30,
    },
  },


  activityEffects: {
    effectsApply: true,
    canAwardEffects: true,
    blockedBlessings: [],
    blockedCurses: [],
    effectAwardPool: {
      nothingWeight: 100,
      blessingWeight: 0,
      curseWeight: 0,
      blessingWeights: {},
      curseWeights: {},
    },
  },

  folders: {
    urgent: { label: 'Urgent', emoji: '⚠️' },
    todo: { label: 'To-Do', emoji: '📋' },
    spam: { label: 'Spam', emoji: '📩' },
    scam: { label: 'Scam', emoji: '🚫' },
  },

  templates: {
    urgent: [
      family(
        'service_outage',
        ['alerts@echoworkflowhub.com', 'status@echoworkflowhub.com', 'ops-alerts@echoworkflowhub.com'],
        ['Immediate Action Required - Service Access Issue', 'Workflow Service Interruption Needs Review', 'Critical Platform Alert - Response Needed'],
        [
          'Hi,\n\nA platform issue has been identified during routine monitoring and it is now affecting one or more shared workflow tools. Several queued actions may stall until the affected service is reviewed and acknowledged by staff.',
          'Hi,\n\nMonitoring picked up a live issue impacting part of the workflow platform. Some shared tools are already showing delays, and unattended jobs may continue to stack up until someone reviews the alert.',
          'Hi,\n\nOur status checks detected an active service problem that may interrupt access to connected workflow features. The issue has moved beyond a routine warning and now needs immediate staff attention.',
        ],
        [
          'Please review the incident details as soon as possible and confirm whether your current tasks are affected. If no action is taken in the next few hours, additional restrictions may be applied automatically to prevent further disruption.',
          'Please check the affected service and confirm the impact on your current queue. If left unresolved for too long, linked processes may pause automatically until the fault is cleared by staff.',
          'Please assess the issue promptly and escalate if the interruption is affecting active work. Waiting too long may cause connected actions to be suspended until the platform confirms a stable state again.',
        ],
        internalSupportSignoffs
      ),
      family(
        'deadline_slip',
        ['supervisor.alerts@echoworkflowhub.com', 'deadlines@echoworkflowhub.com', 'operations@echoworkflowhub.com'],
        ['Escalated Deadline Risk - Immediate Review Needed', 'Priority Deadline Alert', 'Outstanding Work Requires Immediate Attention'],
        [
          'Hi,\n\nAn item due for release today has not moved since the last review window and now carries an escalation flag. Because the dependency chain touches multiple tasks, delays here may flow through the rest of the day if they are not addressed quickly.',
          'Hi,\n\nA deliverable scheduled for today is now at risk of missing its deadline. It has already triggered an escalation marker because related work is waiting on the next update from your side.',
          'Hi,\n\nOne of today\'s tracked items has slipped beyond its expected review point and now needs urgent attention. The delay is beginning to affect downstream work that cannot progress without a fresh status update.',
        ],
        [
          'Please review the item immediately, update its progress, and flag any blockers before the next check-in. If it remains untouched, the task may be reassigned or held until management can step in.',
          'Please confirm the current status as soon as possible and note anything preventing completion. If we do not see movement shortly, the task may be escalated further to keep the remaining schedule intact.',
          'Please update the record urgently and advise whether support is required. Leaving it unresolved may force the wider run sheet to be reworked around the delay.',
        ],
        internalManagerSignoffs
      ),
      family(
        'security_hold',
        ['securitydesk@echoworkflowhub.com', 'identity@echoworkflowhub.com', 'alerts@secure.echoworkflowhub.com'],
        ['Immediate Review Needed - Login Hold Applied', 'Security Review Flagged Your Access Session', 'Critical Access Review Required Today'],
        [
          'Hi,\n\nA security review has placed a temporary hold on part of your account access after an authentication mismatch was detected during a routine policy check. This does not necessarily indicate compromise, but it does need to be reviewed before normal access is restored.',
          'Hi,\n\nAn access policy check flagged your current session and applied a temporary hold to selected tools while the mismatch is assessed. This can happen after a security refresh, but it still requires a same-day review from staff.',
          'Hi,\n\nYour account session was marked for manual review during a scheduled security validation, and some linked features may stay restricted until the matter is checked. The hold appears procedural, but it now requires immediate attention.',
        ],
        [
          'Please contact the service desk or review the account notes immediately so the hold can be cleared before it begins disrupting your work. If the review is ignored, access may remain limited for the rest of the day.',
          'Please assess the alert now and verify whether the lock was applied correctly. Delaying the review may leave connected systems unavailable until the next security cycle runs.',
          'Please follow up on the hold as soon as possible so access can be restored if everything checks out. Waiting too long may keep your tools restricted until another manual review is completed.',
        ],
        internalSupportSignoffs
      ),
      family(
        'payroll_exception',
        ['payroll@echoworkflowhub.com', 'finance.alerts@echoworkflowhub.com', 'accounts@echoworkflowhub.com'],
        ['Urgent Payroll Exception Requires Review', 'Payment Processing Issue - Immediate Response Needed', 'Today\'s Payroll Batch Flagged for Attention'],
        [
          'Hi,\n\nA payroll exception has been raised against today\'s processing batch and it may affect one or more scheduled entries unless it is reviewed before cutoff. The issue appears to be administrative rather than technical, but it still needs same-day action.',
          'Hi,\n\nFinance has identified an exception in the current payroll batch that may delay processing if left unresolved. At this stage it looks like a review issue, though the window to correct it is getting tight.',
          'Hi,\n\nToday\'s payroll run has flagged an entry that needs urgent attention before the final submission window closes. It does not appear critical yet, but it may become a payment delay if no one reviews it soon.',
        ],
        [
          'Please review the flagged item immediately and confirm whether any details need to be corrected before cutoff. If the exception remains open, the batch may be held until the next processing cycle.',
          'Please check the payroll note and advise whether the issue can be cleared now. If it is not resolved before the scheduled lock time, payment processing may be deferred automatically.',
          'Please assess the exception as soon as possible and either clear it or escalate it to finance. Waiting too long may push the item into the next payroll cycle.',
        ],
        ['Regards,\nFinance Team', 'Thanks,\nPayroll Desk', 'Thank you,\nAccounts Processing']
      ),
      family(
        'client_escalation',
        ['clientcare@echoworkflowhub.com', 'escalations@echoworkflowhub.com', 'prioritydesk@echoworkflowhub.com'],
        ['Client Escalation Awaiting Immediate Response', 'Priority Client Issue Needs Attention', 'Urgent Follow-Up Requested by Client Care'],
        [
          'Hi,\n\nA client-facing issue has been escalated back through the support queue and is waiting on internal review. The matter is time-sensitive because the client is expecting an update shortly and the next contact window is approaching.',
          'Hi,\n\nClient Care has escalated a matter that now requires urgent internal attention. The request has already bounced through earlier queues and is nearing the point where the client will need a direct answer.',
          'Hi,\n\nA support issue affecting a client has moved into escalation and now needs a same-day review. The case is not yet critical, but the available response window is narrowing quickly.',
        ],
        [
          'Please review the case details immediately and provide either a status update or a clear handoff note. If there is no response before the next contact window, the matter may be escalated again.',
          'Please check the escalation and confirm the next action as soon as possible. Leaving the case idle may force Client Care to log it as a missed follow-up.',
          'Please assess the client record now and advise on the next step before the issue reaches another escalation tier. Delays here are likely to create additional follow-up work later today.',
        ],
        ['Thanks,\nClient Care', 'Regards,\nEscalations Desk', 'Thank you,\nPriority Support']
      ),
      family(
        'system_cutoff',
        ['reminders@echoworkflowhub.com', 'batch-notice@echoworkflowhub.com', 'processing@echoworkflowhub.com'],
        ['Same-Day Cutoff Approaching - Action Required', 'Submission Window Closing Soon', 'Urgent Reminder - Final Processing Window'],
        [
          'Hi,\n\nThis is a reminder that one of today\'s submission windows is closing soon and any unfinished items may roll into the next cycle. The queue currently shows work still awaiting review before that cutoff is reached.',
          'Hi,\n\nA processing window due to close later today still has pending items attached to it. If those items are not checked in time, they may be delayed until the next available batch.',
          'Hi,\n\nOne of the day\'s final system cutoffs is approaching and there are still records waiting on attention. Missing this window may create overnight backlog for work that should have closed out today.',
        ],
        [
          'Please review the open items now and confirm whether they can be completed before the cutoff. Any records left unresolved may be pushed into the next cycle automatically.',
          'Please assess the queue as soon as possible and update anything still pending before the window closes. Once the cutoff passes, no further changes may be accepted until the next run.',
          'Please check the outstanding records immediately and clear what you can before the final processing lock. Waiting any longer may leave them unavailable for same-day completion.',
        ],
        internalOpsSignoffs
      ),
    ],

    todo: [
      family(
        'daily_admin',
        ['admin@echoworkflowhub.com', 'ops@echoworkflowhub.com', 'tasks@echoworkflowhub.com'],
        ['Tasks Requiring Attention Today', 'Today\'s Admin Checklist', 'Daily Workflow Tasks'],
        [
          'Hi,\n\nJust a quick rundown of the work needing attention today. Nothing here is an emergency on its own, but moving through the list steadily will help avoid avoidable carry-over later in the afternoon.',
          'Hi,\n\nHere is the main task list for today\'s admin work. These items are part of the normal daily flow, so please work through them as time permits and keep progress notes current.',
          'Hi,\n\nSharing today\'s admin list so it is all in one place. A few items are time-sensitive, though most simply need to be worked through in a sensible order during the shift.',
        ],
        [
          'Review and respond to pending client emails\nFinalise the weekly report draft and submit for approval\nUpdate the project tracker with current progress\nFollow up on outstanding invoices\nPrepare notes for tomorrow\'s team meeting',
          'Check the shared inbox for unattended items\nUpdate open task records before lunch\nConfirm progress notes on current work\nSend follow-up messages where needed\nPrepare the handover summary for end of day',
          'Clear routine inbox items first\nUpdate the task board with current statuses\nFollow up on any overdue admin actions\nReview tomorrow\'s scheduled work\nLeave notes on anything that needs escalation',
        ],
        internalOpsSignoffs
      ),
      family(
        'meeting_prep',
        ['meetings@echoworkflowhub.com', 'coordination@echoworkflowhub.com', 'admin@echoworkflowhub.com'],
        ['Meeting Prep List for Tomorrow', 'Tomorrow\'s Meeting Preparation', 'Prep Notes Before the Team Meeting'],
        [
          'Hi,\n\nAhead of tomorrow\'s meeting, there are a few preparation tasks that should be wrapped up today so the discussion can stay focused. Most are straightforward housekeeping items rather than urgent fixes.',
          'Hi,\n\nTo keep tomorrow\'s meeting running smoothly, please work through the prep items below when you have a chance today. None require an immediate response, but it helps if they are tidy before close of business.',
          'Hi,\n\nPlease review the following preparation items before tomorrow\'s meeting. These are standard planning tasks and can be handled alongside your usual work during the day.',
        ],
        [
          'Confirm attendance notes are up to date\nReview the latest progress summary\nAdd any discussion points that still need decisions\nCheck whether follow-up items from last meeting were closed\nPrepare a short status note for anything still open',
          'Update the meeting tracker with the latest notes\nMake sure action items have current owners\nList any blockers that should be raised tomorrow\nReview previous decisions for anything still pending\nPrepare a concise summary for the chair',
          'Check the agenda for outdated items\nAdd fresh notes where progress has changed\nConfirm open actions and current owners\nFlag anything needing a decision tomorrow\nLeave summary comments for easy review',
        ],
        internalManagerSignoffs
      ),
      family(
        'inbox_cleanup',
        ['inbox@echoworkflowhub.com', 'ops@echoworkflowhub.com', 'workflow@echoworkflowhub.com'],
        ['Inbox Review Queue', 'Routine Inbox Cleanup', 'Pending Inbox Items for Review'],
        [
          'Hi,\n\nThe shared inbox has accumulated a few routine items that should be worked through today. These are normal queue maintenance tasks rather than urgent issues, but they can become noisy if left untouched too long.',
          'Hi,\n\nThere are several standard inbox items waiting for review. None appear critical at this stage, though it would help to clear them before they begin to stack into tomorrow\'s queue.',
          'Hi,\n\nJust flagging a small set of routine inbox work for today. It is mostly regular follow-up and record tidying, so please work through it when your current priorities allow.',
        ],
        [
          'Review anything older than two business days\nReply or reassign where a response is overdue\nUpdate tags on items that have already moved forward\nArchive resolved threads\nLeave notes on anything that still needs follow-up',
          'Check unattended threads from the shared inbox\nUpdate statuses on items already actioned\nArchive anything that is fully resolved\nReassign items waiting on another team\nLeave notes on messages that still need tracking',
          'Work through older inbox threads first\nTag and file anything already completed\nReply where a routine answer is still needed\nMove unresolved items to the correct queue\nNote anything likely to come back tomorrow',
        ],
        internalOpsSignoffs
      ),
      family(
        'reporting_pack',
        ['reporting@echoworkflowhub.com', 'analytics@echoworkflowhub.com', 'admin@echoworkflowhub.com'],
        ['Reporting Tasks for Today', 'Today\'s Reporting Pack', 'Routine Reporting Follow-Up'],
        [
          'Hi,\n\nPlease work through the reporting tasks below when you have a free window today. These are part of the normal reporting cycle and do not require emergency handling, though it helps to keep them moving.',
          'Hi,\n\nA few reporting items still need attention today. They are routine rather than urgent, but completing them now will make the end-of-day summary much cleaner.',
          'Hi,\n\nSharing the reporting checklist for today so it does not get lost in the general queue. None of it needs immediate intervention, though it should be wrapped before the day finishes.',
        ],
        [
          'Review the latest numbers for obvious anomalies\nUpdate the weekly summary draft\nCheck that all linked records are current\nConfirm pending notes from yesterday were carried across\nPrepare the final pack for sign-off later today',
          'Refresh the reporting tracker with new entries\nCheck whether any figures still need confirmation\nUpdate the written summary where progress has changed\nNote anything missing from linked records\nPrepare the pack for afternoon review',
          'Review outstanding reporting notes\nCheck linked records for any stale entries\nBring the summary draft up to date\nFlag anything that still needs confirmation\nPrepare the final version for sign-off',
        ],
        ['Regards,\nReporting Team', 'Thanks,\nAnalytics Desk', 'Thank you,\nReporting Coordination']
      ),
      family(
        'vendor_followup',
        ['vendors@echoworkflowhub.com', 'procurement@echoworkflowhub.com', 'purchasing@echoworkflowhub.com'],
        ['Vendor Follow-Up List', 'Procurement Tasks to Review', 'Supplier Follow-Up for Today'],
        [
          'Hi,\n\nThere are a few supplier and purchasing follow-ups that should be handled during today\'s shift. None appear urgent at the moment, but clearing them now will prevent delays from building later in the week.',
          'Hi,\n\nPlease work through the supplier follow-up items below when you have capacity. They are routine procurement tasks and mostly just need a clean update or reply logged today.',
          'Hi,\n\nSharing the current vendor follow-up list for today. Most items are straightforward admin rather than high-priority work, though it is best not to leave them hanging too long.',
        ],
        [
          'Check whether open purchase requests have replies\nFollow up on overdue supplier confirmations\nUpdate delivery notes where dates changed\nArchive anything already resolved\nLeave comments on items still awaiting action',
          'Review open supplier threads for new responses\nUpdate dates on any delayed items\nSend reminders where confirmation is still missing\nNote anything that should be escalated later\nClose out resolved requests',
          'Confirm current status on supplier requests\nUpdate records with any changed delivery dates\nSend a quick follow-up where needed\nFlag anything likely to affect future work\nArchive the resolved items',
        ],
        ['Regards,\nProcurement Team', 'Thanks,\nSupplier Coordination', 'Thank you,\nPurchasing Desk']
      ),
      family(
        'account_cleanup',
        ['records@echoworkflowhub.com', 'adminservices@echoworkflowhub.com', 'operations@echoworkflowhub.com'],
        ['Account Cleanup Tasks', 'Routine Record Maintenance', 'Today\'s Record Review Items'],
        [
          'Hi,\n\nThere are several routine account and record maintenance tasks to work through today. They are ordinary housekeeping items and can be handled alongside your normal workload rather than as urgent exceptions.',
          'Hi,\n\nPlease review the current record maintenance list when you have time today. It is standard cleanup work designed to keep the system tidy rather than address an active problem.',
          'Hi,\n\nJust sending through the latest record cleanup tasks for today. These are not urgent issues, but they are worth clearing before they age into the backlog.',
        ],
        [
          'Check older records for missing notes\nUpdate any entries waiting on final comments\nClose items already resolved in another queue\nCorrect obvious tagging issues\nLeave a note on anything requiring follow-up',
          'Review records without recent updates\nAdd final notes where work is already complete\nCorrect any categories that were applied incorrectly\nArchive the resolved items\nFlag anything that still looks incomplete',
          'Scan for stale record entries\nUpdate missing notes where appropriate\nTidy up incorrect tags or categories\nArchive anything already finished\nLeave comments on items still needing work',
        ],
        internalManagerSignoffs
      ),
    ],

    spam: [
      family(
        'gift_card',
        ['promo-rewards@deals-center.biz', 'winnerdesk@reward-central.co', 'gifts@member-perks-mail.com'],
        ['🔥 You\'ve Been Selected - Claim Your Reward Now 🔥', 'Exclusive Reward Waiting For You', 'Your Limited-Time Gift Offer'],
        [
          'Hey there!!!\n\nCongratulations! You have been picked as one of today\'s special reward recipients. As part of our promotional event, a limited-time offer has been reserved for your email and will only remain active for a short period.',
          'Hello!!!\n\nAmazing news! A promotional reward has been linked to your address as part of our current campaign. The offer is available for a limited time and may be reassigned if it is not claimed quickly.',
          'Good news!!!\n\nYour email has been attached to a member reward in our latest campaign. The claim window is short, so we recommend checking it soon before the offer expires.',
        ],
        [
          'Simply follow the link provided and complete the short confirmation process to secure your reward before the timer expires. Once the promotional window closes, the offer may no longer be available.',
          'All you need to do is review the offer page and complete a brief confirmation step. If the timer runs out first, the reward may be released back into the campaign pool.',
          'Open the reward page and finish the quick claim process before the current window ends. When the countdown expires, the offer may be withdrawn automatically.',
        ],
        spamSignoffs
      ),
      family(
        'newsletter_push',
        ['news@productivityplusmail.com', 'updates@vendor-insider.co', 'inside@businessdigest-mail.com'],
        ['This Week\'s Productivity Picks', 'New Tools, Offers and Tips Inside', 'Your Weekly Vendor Update'],
        [
          'Hi,\n\nHere is this week\'s roundup of product highlights, feature announcements, and offers from across our partner network. We hope these updates help you stay informed about the latest improvements and promotions available right now.',
          'Hi,\n\nThanks for being on our mailing list. We\'ve gathered this week\'s featured tips, product notices, and partner promotions into one update for easy reading whenever you have a spare moment.',
          'Hi,\n\nWelcome to this week\'s update from our partner newsletter. Inside you\'ll find product tips, vendor news, and several featured promotions currently running across our network.',
        ],
        [
          'Browse the latest vendor highlights, review current offers, and see what new features other teams are talking about this week. There is nothing urgent here, but plenty to explore if you are interested.',
          'Take a look through the featured updates to see what is new, what is trending, and which offers are currently active. Feel free to save this email for later if the timing is not right today.',
          'Review the latest updates, read through the featured stories, and check out any offers that catch your eye. This message is purely informational and can be ignored if it is not relevant.',
        ],
        spamSignoffs
      ),
      family(
        'training_offer',
        ['events@skill-boosters.co', 'courses@careerstack-mail.com', 'learn@masterclass-for-work.biz'],
        ['Seats Filling Fast For This Week\'s Training', 'Upgrade Your Skills With Our Latest Course', 'Invitation: New Professional Workshop'],
        [
          'Hi,\n\nWe are excited to share a new professional workshop designed to help busy teams work smarter and move faster. The latest intake is now open, and remaining places are beginning to fill as registrations continue to come in.',
          'Hi,\n\nA new training program has just opened for registration and may be of interest to professionals looking to sharpen their workflow skills. Demand has been strong, and the current intake will close once all places are filled.',
          'Hi,\n\nOur latest online workshop is now open and includes practical lessons designed for modern workplaces. Registrations are moving quickly, so now is a good time to review the details if it sounds useful.',
        ],
        [
          'Review the session outline, compare the available times, and reserve your place if it suits your interests. This is an optional offer and no response is required unless you want to participate.',
          'Take a look at the course information, explore the available sessions, and register if the topic seems valuable to you. The message is promotional and can be skipped if it is not relevant.',
          'Browse the workshop details and sign up if you would like to attend. There is no need to respond unless you decide the offer is worth your time.',
        ],
        spamSignoffs
      ),
      family(
        'software_offer',
        ['sales@taskstack-mail.com', 'hello@appmarketingsuite.co', 'offers@biztoolbox-news.com'],
        ['Special Offer On New Workflow Software', 'Save On Tools For Your Team This Month', 'Product Offer For Growing Teams'],
        [
          'Hi,\n\nWe wanted to let you know about a limited promotional offer on our workflow software package for growing teams. The package includes premium features, reporting options, and integrations intended to streamline everyday work.',
          'Hi,\n\nOur current promotion on team workflow software is now live and available for a limited time. It includes discounted access to premium features designed to improve organisation and visibility.',
          'Hi,\n\nA monthly promotional offer is now available on our workflow software suite. The package includes upgraded tools aimed at helping teams track tasks, share updates, and stay aligned.',
        ],
        [
          'Take a look at the current package details and compare the pricing before the promotion ends. There is no action required unless you are interested in the offer.',
          'Feel free to review the offer and see whether the package suits your needs. This is a sales message only and can be ignored if it is not useful.',
          'Open the offer page to learn more about the current package, available discounts, and the included features. No response is needed unless you want to explore the product.',
        ],
        spamSignoffs
      ),
      family(
        'survey_push',
        ['feedback@prizeloop-mail.com', 'survey@consumerpulse-hub.co', 'reviews@instant-reward-mail.com'],
        ['Quick Survey - Reward Opportunity', 'Share Your Thoughts And Unlock A Bonus', 'One Minute Survey Invitation'],
        [
          'Hi,\n\nWe are inviting a limited number of participants to complete a short survey about digital habits and workplace preferences. As a thank-you for taking part, selected participants may be eligible for a promotional reward once their response is submitted.',
          'Hi,\n\nA short survey is now open to selected recipients and may unlock a promotional bonus once completed. It only takes a moment to review and respond, making it an easy opportunity for interested participants.',
          'Hi,\n\nYou have been invited to complete a quick survey connected to our latest promotional campaign. Participants who respond may become eligible for a follow-up reward or offer.',
        ],
        [
          'Review the survey details and complete the short form if you want to participate. This is purely promotional and can be skipped if it is not of interest.',
          'Feel free to open the survey page and submit a response if the offer sounds worthwhile. No action is needed unless you decide to take part.',
          'Take a look at the survey information and complete it only if you would like to join the promotion. The message can safely be ignored otherwise.',
        ],
        spamSignoffs
      ),
      family(
        'event_invite',
        ['invites@growthsummit-mail.com', 'register@network-now.co', 'events@industrybuzzmail.com'],
        ['Reserve Your Spot At Our Upcoming Event', 'You\'re Invited To This Week\'s Online Session', 'Registration Open For New Industry Event'],
        [
          'Hi,\n\nRegistration is now open for our upcoming online event featuring short sessions, guest speakers, and practical discussions around workplace trends. Places are available while capacity lasts, and you are welcome to review the details if interested.',
          'Hi,\n\nWe are hosting a new online event this week and wanted to extend an invitation while registrations remain open. The session includes presentations, networking opportunities, and product showcases from participating partners.',
          'Hi,\n\nA fresh industry event is now open for registration and may be of interest if you enjoy short expert sessions and practical updates. Attendance is optional, and details are available online for anyone who wants to explore the program.',
        ],
        [
          'Browse the event page, review the agenda, and register if the topic appeals to you. This is promotional outreach and can be filed away if it is not relevant.',
          'Open the registration page to see the speaker list and available sessions. There is no need to reply unless you would like to sign up.',
          'Take a look at the event details and reserve a place only if it suits your interests. Otherwise, feel free to ignore the message.',
        ],
        spamSignoffs
      ),
    ],

    scam: [
      family(
        'phish_access_revalidation',
        ['support@echoworkflowhub.co', 'access@workflow-auth.co', 'identity@echoworkflowhub.net'],
        ['Account Session Expiry Notice', 'Session Revalidation Required Today', 'Workflow Access Review Pending'],
        [
          'Hi,\n\nDuring a routine access review, we identified that your current session credentials may require revalidation to avoid interruption to connected workflow tools. This can happen after backend security updates or policy refreshes and usually only takes a moment to resolve.',
          'Hi,\n\nOur systems recorded an access mismatch during a routine security refresh, and your active session may now require revalidation to remain linked with connected workflow tools. This type of review is generally procedural and can be completed quickly.',
          'Hi,\n\nA scheduled access audit has identified that your current session details may need to be revalidated to keep connected workflow services active. These checks are routine, though unresolved sessions may experience limited access later in the day.',
        ],
        [
          'Please complete the secure verification step linked below so your access remains active for the rest of the workday. Users who do not confirm their session may experience delays when accessing shared dashboards or task routing tools.',
          'Please use the secure review link below to confirm your access details and avoid interruption to connected services. Accounts left unverified may be placed into a limited-access state until the review clears.',
          'Please follow the review link to confirm your access status before the next sync window. Sessions not revalidated in time may be held from selected workflow tools until the issue is resolved.',
        ],
        scamSignoffs
      ),
      family(
        'phish_payroll_portal',
        ['payroll@echoworkflowhub.co', 'accounts@payroll-review.net', 'paysupport@workflow-payments.com'],
        ['Payroll Access Review Needed', 'Action Needed Before Payslip Release', 'Payroll Portal Verification Required'],
        [
          'Hi,\n\nYour payroll profile has been included in a scheduled review after a portal settings mismatch was detected during pre-release checks. This does not automatically indicate an error, though unresolved profiles may be delayed from the next statement cycle.',
          'Hi,\n\nA review flag has been attached to your payroll profile following an automated pre-release check. These checks are usually straightforward, but any profile left unresolved may experience delays when the next statements are issued.',
          'Hi,\n\nAn automated review identified a payroll portal mismatch tied to your current profile settings. The issue appears administrative, though it now needs to be confirmed before the next release window closes.',
        ],
        [
          'Please confirm your profile details through the payroll review page linked below. If the review remains incomplete, access to updated statement information may be limited until the next processing cycle.',
          'Please use the verification page below to confirm your payroll details before the release window closes. Accounts still pending review may be held from updated statement access until cleared.',
          'Please review and confirm your payroll profile using the secure link provided. Failure to complete the check may delay access to the next statement cycle.',
        ],
        ['Regards,\nPayroll Review', 'Thank you,\nPayroll Access Team', 'Thanks,\nPayment Services']
      ),
      family(
        'phish_shared_document',
        ['documents@echoworkflowhub.net', 'share@workflow-docs.co', 'review@echoworkflow-share.com'],
        ['Shared Document Waiting For Review', 'New File Shared With You', 'Action Needed On Pending Document'],
        [
          'Hi,\n\nA document has been shared with your account and is awaiting review before the current access window expires. The file was marked for direct delivery, which is why it did not pass through the normal foldering process.',
          'Hi,\n\nA file has been routed to your account and remains pending review. Because it was delivered through a shared access workflow, the link may expire if it is not opened within the current window.',
          'Hi,\n\nYou have been granted access to a shared document that is still waiting for your review. The delivery method used for this file requires it to be opened within the active access period.',
        ],
        [
          'Please review the document through the secure link below so the sender can see that it has been received. Files not opened in time may need to be reissued through the sharing portal.',
          'Please open the file using the review link provided and confirm receipt once the page loads. Pending links may expire automatically if they are not accessed during the current window.',
          'Please follow the secure document link below to review the file while the current access period remains active. Unopened files may be withdrawn and require a new share request.',
        ],
        ['Regards,\nDocument Delivery', 'Thanks,\nShared Access Team', 'Thank you,\nReview Services']
      ),
      family(
        'phish_manager_impersonation',
        ['admin.desk@echoworkflow-support.com', 'coordination@echoworkflow-helpdesk.com', 'opslead@echoworkflowhub.co'],
        ['Quick Check Before Today\'s Handover', 'Need You To Review One Item', 'Can You Handle This Before Midday'],
        [
          'Hi,\n\nBefore today\'s handover, I need one small item reviewed on your side so it does not remain sitting in the queue. It should only take a minute and is easier to clear now than to push into the next review cycle.',
          'Hi,\n\nI just need one quick item checked before midday so it does not carry over into the next handover. It is routine and should not take long once you open the review page.',
          'Hi,\n\nCan you handle one quick review item for me before the current queue rolls over? It is a simple check and should only take a moment if you can get to it now.',
        ],
        [
          'Use the link below to review the item directly and confirm once done. If it is not cleared before the queue refreshes, it may need to be reissued through admin.',
          'Please open the review page below and confirm the item so it does not sit idle in the queue. Leaving it unresolved may cause it to be reissued later today.',
          'Follow the link below to complete the check and keep it from falling into the next queue cycle. If it stays untouched, the item may need to be reassigned manually.',
        ],
        ['Thanks,\nAdmin Desk', 'Regards,\nCoordination', 'Thank you,\nOperations Support']
      ),
      family(
        'phish_invoice',
        ['billing@echoworkflowhub.net', 'accounts@invoice-portal.co', 'remittance@workflow-payments.co'],
        ['Invoice Review Needed', 'Outstanding Billing Item Requires Attention', 'Billing Notice Attached For Review'],
        [
          'Hi,\n\nA billing item linked to your details is awaiting review and may remain open until the attached record is confirmed. The notice appears to be part of a normal reconciliation process, though it has been marked for prompt attention.',
          'Hi,\n\nA remittance item has been flagged for review under your account reference and may stay unresolved until the linked billing page is checked. At this stage it appears to be part of routine reconciliation.',
          'Hi,\n\nAn invoice-related item has been queued against your details and now needs review. The matter looks administrative, but it has been tagged for prompt handling to avoid unnecessary follow-up notices.',
        ],
        [
          'Please open the billing review page below and confirm the record so it can be cleared. If it remains pending, further notices may continue to be issued automatically.',
          'Please access the linked billing page and review the item so the notice can be closed out. Records that stay unresolved may trigger another reminder cycle.',
          'Please review the billing record through the secure link below and confirm whether the item is valid. Pending notices may continue to generate follow-up reminders until resolved.',
        ],
        ['Regards,\nBilling Team', 'Thanks,\nAccounts Review', 'Thank you,\nPayment Coordination']
      ),
      family(
        'phish_benefits',
        ['benefits@echoworkflowhub.co', 'hrportal@workflow-benefits.net', 'staffcare@echoworkflow-help.com'],
        ['Benefits Profile Needs Confirmation', 'Staff Benefits Review Pending', 'Action Required On Benefits Settings'],
        [
          'Hi,\n\nYour staff benefits profile was selected for a routine confirmation review after a recent system sync. The update appears minor, though incomplete records may be excluded from the next refresh cycle until they are confirmed.',
          'Hi,\n\nA recent profile sync has placed your benefits record into a confirmation queue. This is often a routine step, but any record left pending may not reflect correctly in the next scheduled update.',
          'Hi,\n\nYour benefits settings have been queued for confirmation following an automated system review. The change may be minor, though it now requires a quick check to keep the profile current.',
        ],
        [
          'Please use the secure page below to confirm your current settings and avoid delays in the next update cycle. Profiles not reviewed in time may remain in a pending state until manually cleared.',
          'Please follow the review link below and confirm your settings so the profile can move out of the pending queue. Unconfirmed records may stay excluded from the next sync window.',
          'Please open the secure review page below and verify your current settings. If the record remains pending, the update may not be processed on schedule.',
        ],
        ['Regards,\nBenefits Team', 'Thank you,\nHR Services', 'Thanks,\nStaff Care']
      ),
      family(
        'phish_storage_limit',
        ['storage@echoworkflowhub.net', 'files@secure-workspace.co', 'noreply@workflow-storage.com'],
        ['Storage Quota Review Notice', 'Workspace Storage Needs Confirmation', 'File Access May Be Limited Soon'],
        [
          'Hi,\n\nA storage review has identified that your workspace allocation may need confirmation before the next automatic sync. This type of notice is usually precautionary, though unresolved accounts may see some file access limitations.',
          'Hi,\n\nYour workspace storage settings have been queued for review ahead of the next file sync cycle. The notice appears preventative, but delayed confirmation may still affect access to connected files.',
          'Hi,\n\nA storage allocation check has placed your workspace into a temporary review queue. The matter does not appear severe, though pending accounts may be restricted from selected file actions until reviewed.',
        ],
        [
          'Please review your storage details through the secure page below so the allocation remains active. Accounts not confirmed in time may experience limits on shared file access.',
          'Please open the review page below and confirm your storage settings to keep everything synced. Unreviewed accounts may be moved into a restricted storage state automatically.',
          'Please confirm your current storage allocation using the secure link below. Failure to complete the review may result in temporary limits being applied to file access.',
        ],
        ['Regards,\nWorkspace Storage', 'Thanks,\nFile Services', 'Thank you,\nStorage Coordination']
      ),
      family(
        'phish_security_notice',
        ['alerts@cloudauth-alerts.net', 'accountsupport@cloud-accessreview.com', 'security@identity-warning.co'],
        ['Suspicious Account Activity Detected', 'Unusual Sign-In Attempt Noted', 'Protective Access Review Needed'],
        [
          'Dear Customer,\n\nWe have detected unusual activity on your Account ID that requires immediate attention. Multiple login attempts were made from an unrecognized device and location earlier today, and some features may remain limited until the review is completed.',
          'Dear Customer,\n\nOur systems recorded sign-in activity from a device and location not previously associated with your account. To protect your access, certain features may stay restricted until the account review is finalized.',
          'Dear Customer,\n\nA protective security check has been triggered after unusual sign-in activity was detected on your account. Some services may remain limited while the activity is reviewed to prevent unauthorized access.',
        ],
        [
          'To restore full access and secure your account, please verify your information through the link below. If we do not receive confirmation within 24 hours, your account may remain locked to prevent further risk.',
          'Please confirm your details using the secure link below so the account review can be completed. Accounts left unverified may remain restricted until another manual review is performed.',
          'Use the verification page below to confirm your account details and restore normal access. Failure to complete the review may leave the account in a limited state.',
        ],
        scamSignoffs
      ),
      family(
        'phish_vendor_portal',
        ['vendors@workflow-review.net', 'supplieraccess@echoworkflowhub.co', 'portal@vendor-reconcile.com'],
        ['Supplier Portal Review Required', 'Vendor Access Notice', 'Portal Sync Needs Confirmation'],
        [
          'Hi,\n\nA supplier portal sync has attached a review flag to your access and may prevent updated records from appearing until it is confirmed. This often happens after vendor-side changes and usually only requires a quick check.',
          'Hi,\n\nYour vendor portal access has been marked for confirmation after a recent sync detected a mismatch. The issue appears routine, though linked supplier records may remain unavailable until the review is completed.',
          'Hi,\n\nA recent supplier-side sync has placed your portal access into a temporary review queue. While it may be procedural, unresolved access may stop some updated records from loading correctly.',
        ],
        [
          'Please use the supplier review page below to confirm access and restore normal record visibility. Delayed confirmation may keep linked items unavailable until the next sync cycle.',
          'Please open the linked portal page and complete the confirmation step so supplier records continue to load as expected. Pending access reviews may remain unresolved until manually cleared.',
          'Please review the linked portal notice below and confirm your access details. If ignored, some supplier records may stay unavailable for the rest of the current cycle.',
        ],
        ['Regards,\nSupplier Access', 'Thanks,\nVendor Reconciliation', 'Thank you,\nPortal Services']
      ),
      family(
        'phish_policy_acknowledgement',
        ['policy@echoworkflowhub.co', 'compliance@policy-refresh.net', 'acknowledgements@workflow-policy.com'],
        ['Policy Acknowledgement Needed', 'Compliance Notice Waiting For Confirmation', 'Updated Policy Record Requires Review'],
        [
          'Hi,\n\nA policy acknowledgement item has been attached to your profile following a recent compliance refresh. The change appears routine, though records without confirmation may stay open in the next audit cycle.',
          'Hi,\n\nYour profile has been queued for a policy acknowledgement check after an automated compliance update. This is often standard process, but it still needs to be confirmed to avoid carrying into the next review window.',
          'Hi,\n\nAn updated policy record has been linked to your account and now requires acknowledgement. The notice appears administrative, though unresolved acknowledgements may remain visible in compliance reporting.',
        ],
        [
          'Please review and confirm the updated record using the secure page below so the acknowledgement can be logged. Profiles left pending may continue to appear on outstanding compliance lists.',
          'Please open the linked compliance page and complete the acknowledgement step. Records not confirmed in time may remain flagged until another manual sweep is performed.',
          'Please use the acknowledgement page below to confirm receipt of the updated record. Unconfirmed profiles may continue to show as outstanding in later compliance reviews.',
        ],
        ['Regards,\nCompliance Services', 'Thanks,\nPolicy Review', 'Thank you,\nAcknowledgement Team']
      ),
    ],
  },
};
