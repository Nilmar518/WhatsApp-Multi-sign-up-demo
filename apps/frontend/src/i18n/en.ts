import type { TranslationKey } from './es';

export const en: Record<TranslationKey, string> = {
  // Navigation
  'nav.principal':               'Main',
  'nav.integrations':            'Integrations',
  'nav.system':                  'System',
  'nav.dashboard':               'Dashboard',
  'nav.messages':                'Messages',
  'nav.inventory':               'Inventory',
  'nav.whatsapp':                'WhatsApp',
  'nav.messenger':               'Messenger',
  'nav.instagram':               'Instagram',
  'nav.channex':                 'Channex',
  'nav.airbnb':                  'Airbnb',
  'nav.booking':                 'Booking.com',
  'nav.settings':                'Settings',
  'nav.myAccount':               'My account',
  'nav.logout':                  'Log out',
  'nav.lightMode':               'Light mode',
  'nav.darkMode':                'Dark mode',
  'nav.expandMenu':              'Expand menu',
  'nav.collapseMenu':            'Collapse menu',
  'nav.changeLang':              'Change language',

  // Common
  'common.save':                 'Save changes',
  'common.cancel':               'Cancel',
  'common.yes':                  'Yes',
  'common.no':                   'No',
  'common.edit':                 'Edit',
  'common.retry':                'Retry',
  'common.copy':                 'Copy',
  'common.copied':               'Copied',
  'common.close':                'Close',
  'common.editUser':             'Edit user',
  'common.deleteUser':           'Delete user',

  // App header
  'app.dashboard':               'Dashboard',
  'app.messages':                'Messages',
  'app.subtitle.dashboard':      'Integration status and configuration.',
  'app.subtitle.messages':       'Real-time multi-channel conversations.',
  'app.verifying.messenger':     'Verifying Messenger integration...',
  'app.verifying.instagram':     'Verifying Instagram integration...',

  // Business toggle
  'toggle.label':                'Integration',
  'toggle.number1':              'Number 1',
  'toggle.number2':              'Number 2',

  // Dashboard — time helpers ({n} = dynamic number)
  'dash.time.now':               'just now',
  'dash.time.minAgo':            '{n} min ago',
  'dash.time.hourAgo':           '{n}h ago',
  'dash.time.dayAgo':            '{n}d ago',

  // Dashboard — channel card
  'dash.channel.active':         'Active',
  'dash.channel.offline':        'Not connected',
  'dash.channel.msgsToday':      'Messages today',
  'dash.channel.convs':          'Conversations',
  'dash.channel.viewConvs':      'View conversations →',
  'dash.channel.connect':        'Connect',

  // Dashboard — recent conversations
  'dash.recentConvs.title':      'Recent conversations',
  'dash.recentConvs.viewAll':    'View all →',
  'dash.recentConvs.empty':      'No conversations yet.',

  // Dashboard — catalog card
  'dash.catalog.title':          'Catalog',
  'dash.catalog.active':         'Active catalog',
  'dash.catalog.manage':         'Manage →',
  'dash.catalog.noChannel':      'Connect at least one channel to link the catalog.',
  'dash.catalog.total':          'Total',
  'dash.catalog.inStock':        'In stock',
  'dash.catalog.outOfStock':     'Out of stock',

  // Dashboard — properties card
  'dash.props.title':            'Channex Properties',
  'dash.props.viewAll':          'View all →',
  'dash.props.loading':          'Loading properties…',
  'dash.props.empty':            'No properties registered.',
  'dash.props.noOta':            'No OTA channels',
  'dash.props.more':             'more',

  // Dashboard — KPI section
  'dash.kpi.section':            'Today\'s metrics',
  'dash.kpi.msgsToday':          'Messages today',
  'dash.kpi.activeConvs':        'Active conversations',
  'dash.kpi.noConvs':            'No conversations yet',
  'dash.kpi.channels':           'Connected channels',
  'dash.kpi.allActive':          'All active',
  'dash.kpi.pending':            'Pending:',
  'dash.kpi.products':           'Products in catalog',
  'dash.kpi.noCatalog':          'No catalog linked',
  'dash.kpi.inStock':            'in stock',
  'dash.channels.section':       'Channel status',

  // Dashboard — HTTPS warning
  'dash.insecure.title':         'Insecure connection.',
  'dash.insecure.body':          'Meta requires HTTPS. Use',

  // Chat console
  'chat.pendingToken':           'Finalizing secure connection...',
  'chat.selectConv':             'Select a conversation',
  'chat.selectContact':          'Select a contact on the left to view the conversation.',
  'chat.noMessages':             'No messages yet. Ask them to send you a message first.',
  'chat.typeReply':              'Type a reply…',
  'chat.selectFirst':            'Select a conversation first',
  'chat.send':                   'Send',

  // Conversation list
  'convList.title':              'Conversations',
  'convList.empty':              'No conversations yet. Messages will appear here.',

  // Integration status labels
  'status.idle':                 'Not connected',
  'status.connecting':           'Connecting...',
  'status.pendingToken':         'Awaiting token...',
  'status.active':               'Connected',
  'status.accountResolved':      'Account resolved',
  'status.error':                'Connection error',
  'status.migrating':            'Migrating...',
  'status.verifyingAccount':     'Verifying your Facebook account...',
  'status.activatingNumber':     'Activating WhatsApp number...',
  'status.confirmingStatus':     'Confirming number status...',
  'status.catalogLinked':        'Catalog linked — finalizing...',
  'status.finalizingConn':       'Finalizing connection...',
  'status.pageLinked':           'Page linked — subscribing webhooks...',
  'status.messengerConnected':   'Messenger Connected',
  'status.loading':              'Loading status...',
  'status.connectedCheck':       'Connected ✓',

  // Connection gateway
  'conn.connectWhatsApp':        'Connect WhatsApp',
  'conn.connecting':             'Connecting...',
  'conn.awaitingToken':          'Awaiting token...',
  'conn.migrating':              'Migrating...',
  'conn.connected':              'Connected',
  'conn.retry':                  'Reconnect',
  'conn.chooseMethod':           'Choose how to register your number.',
  'conn.headsUpTitle':           'Heads up:',
  'conn.headsUpBody':            'If your number is active on WhatsApp on a phone, standard registration will ask you to delete that account. Use Force Migration to skip this step.',
  'conn.standard.title':         'Standard Connection',
  'conn.standard.desc':          'Meta Embedded Signup popup. Works for new or unregistered numbers.',
  'conn.standard.sub':           'Opens the Meta Embedded Signup popup. If it fails or closes unexpectedly, you will be guided to Force Migration automatically.',
  'conn.force.desc':             'Enter your number and verify via OTP. No popup.',
  'conn.back':                   '← Back',
  'conn.step.verify':            'Verify account',
  'conn.step.activate':          'Activate number',
  'conn.step.confirm':           'Confirm status',
  'conn.step.subscribe':         'Subscribe',
  'conn.step.done':              'Done',

  // Force migration
  'migration.signupIncomplete':  'Registration incomplete.',
  'migration.signupBody':        'Your number may be linked to your account. Enter it below and we\'ll complete the migration automatically.',
  'migration.enterNumber':       'Enter your WhatsApp number',
  'migration.includeCode':       'Include the country code. Example:',
  'migration.settingUp':         'Setting up...',
  'migration.sendCode':          'Send verification code →',
  'migration.howToSend':         'How should we send you the code?',
  'migration.codeDelivery':      'A 6-digit code will be sent to',
  'migration.voiceOption':       '📞 Call',
  'migration.sending':           'Sending...',
  'migration.sendViaSms':        'Send via SMS →',
  'migration.sendViaVoice':      'Send via call →',
  'migration.enterOtp':          'Enter the 6-digit code',
  'migration.checkSms':          'Check your SMS messages.',
  'migration.checkCall':         'Answer the call to your phone.',
  'migration.otpWarning':        'Submitting this code will disconnect the number from the WhatsApp app.',
  'migration.verifying':         'Verifying...',
  'migration.verify':            'Verify →',
  'migration.setPin':            'Set a 6-digit security PIN',
  'migration.pinDesc':           'This PIN protects your number on WhatsApp Cloud API.',
  'migration.activating':        'Activating...',
  'migration.activate':          'Activate number →',
  'migration.complete':          'Migration complete!',
  'migration.completeBody':      'is now live on WhatsApp Cloud API. The dashboard will update automatically.',

  // Auth — LoginPage
  'auth.appSubtitle':            'Sign in to your account',
  'auth.email':                  'Email address',
  'auth.emailPlaceholder':       'you@example.com',
  'auth.password':               'Password',
  'auth.login':                  'Sign in',
  'auth.loggingIn':              'Signing in…',
  'auth.invalidCreds':           'Invalid credentials. Please check your email and password.',

  // Auth — ChangePasswordForm
  'auth.changePassword':         'Change password',
  'auth.firstSession':           'This is your first session. For security, please set a new password.',
  'auth.newPassword':            'New password',
  'auth.confirmPassword':        'Confirm password',
  'auth.saving':                 'Saving…',
  'auth.pwMinLength':            'Password must be at least 8 characters.',
  'auth.pwUppercase':            'Password must contain at least one uppercase letter.',
  'auth.pwNumber':               'Password must contain at least one number.',
  'auth.pwMismatch':             'Passwords do not match.',
  'auth.pwError':                'An error occurred. Please try again.',

  // Settings
  'settings.title':              'System Settings',
  'settings.tab.users':          'Users',

  // Users — table
  'users.addUser':               'Add user',
  'users.count':                 'users',
  'users.col.name':              'Name',
  'users.col.email':             'Email',
  'users.col.phone':             'Phone',
  'users.col.country':           'Country',
  'users.col.role':              'Role',
  'users.col.actions':           'Actions',
  'users.empty':                 'No users registered.',
  'users.loadError':             'Error loading users',
  'users.confirmDelete':         'Confirm?',
  'users.role.owner':            'Owner',
  'users.role.admin':            'Admin',
  'users.role.customer':         'Customer',

  // Users — CreateUserModal
  'users.create.title':          'Add user',
  'users.create.submit':         'Create user',
  'users.create.creating':       'Creating...',
  'users.create.success':        'User created successfully',
  'users.create.oneTime':        'This password is shown only once. Copy it before closing.',
  'users.create.error':          'Error creating user',

  // Users — EditUserModal
  'users.edit.title':            'Edit user',
  'users.edit.submit':           'Save changes',
  'users.edit.saving':           'Saving...',
  'users.edit.error':            'Error updating user',

  // Users — form field labels
  'users.field.name':            'Name',
  'users.field.email':           'Email',
  'users.field.phone':           'Phone',
  'users.field.country':         'Country',
  'users.field.role':            'Role',

  // Users — validation errors
  'users.val.nameRequired':      'Name is required',
  'users.val.emailRequired':     'Email is required',
  'users.val.emailInvalid':      'Enter a valid email',
  'users.val.phoneRequired':     'Phone is required',
  'users.val.phoneInvalid':      'Digits only',

  // Users — placeholders
  'users.ph.name':               'Full name',
  'users.ph.email':              'email@example.com',
  'users.ph.phone':              'Digits only',

  // Channex
  'channex.manager':             'Channex Channel Manager',
  'channex.propertyHub':         'Migo App · Property Hub',
  'channex.tab.properties':      'Properties',
  'channex.tab.airbnb':          'Airbnb',
  'channex.tab.booking':         'Booking.com',
  'channex.tab.pools':           'Pools',

  // Airbnb
  'airbnb.integration':          'Airbnb Integration',
  'airbnb.shell':                'Migo App · Airbnb',
};
