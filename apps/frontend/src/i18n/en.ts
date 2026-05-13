import type { TranslationKey } from './es';

export const en: Record<TranslationKey, string> = {
  // Navigation
  'nav.principal':          'Main',
  'nav.integrations':       'Integrations',
  'nav.system':             'System',
  'nav.dashboard':          'Dashboard',
  'nav.messages':           'Messages',
  'nav.inventory':          'Inventory',
  'nav.whatsapp':           'WhatsApp',
  'nav.messenger':          'Messenger',
  'nav.instagram':          'Instagram',
  'nav.channex':            'Channex',
  'nav.airbnb':             'Airbnb',
  'nav.booking':            'Booking.com',
  'nav.settings':           'Settings',
  'nav.myAccount':          'My account',
  'nav.logout':             'Log out',
  'nav.lightMode':          'Light mode',
  'nav.darkMode':           'Dark mode',
  'nav.expandMenu':         'Expand menu',
  'nav.collapseMenu':       'Collapse menu',
  'nav.changeLang':         'Change language',

  // Common
  'common.save':            'Save changes',
  'common.cancel':          'Cancel',
  'common.yes':             'Yes',
  'common.no':              'No',
  'common.edit':            'Edit',
  'common.retry':           'Retry',
  'common.copy':            'Copy',
  'common.copied':          'Copied',
  'common.close':           'Close',
  'common.editUser':        'Edit user',
  'common.deleteUser':      'Delete user',

  // Auth — LoginPage
  'auth.appSubtitle':       'Sign in to your account',
  'auth.email':             'Email address',
  'auth.emailPlaceholder':  'you@example.com',
  'auth.password':          'Password',
  'auth.login':             'Sign in',
  'auth.loggingIn':         'Signing in…',
  'auth.invalidCreds':      'Invalid credentials. Please check your email and password.',

  // Auth — ChangePasswordForm
  'auth.changePassword':    'Change password',
  'auth.firstSession':      'This is your first session. For security, please set a new password.',
  'auth.newPassword':       'New password',
  'auth.confirmPassword':   'Confirm password',
  'auth.saving':            'Saving…',
  'auth.pwMinLength':       'Password must be at least 8 characters.',
  'auth.pwUppercase':       'Password must contain at least one uppercase letter.',
  'auth.pwNumber':          'Password must contain at least one number.',
  'auth.pwMismatch':        'Passwords do not match.',
  'auth.pwError':           'An error occurred. Please try again.',

  // Settings
  'settings.title':         'System Settings',
  'settings.tab.users':     'Users',

  // Users — table
  'users.addUser':          'Add user',
  'users.count':            'users',
  'users.col.name':         'Name',
  'users.col.email':        'Email',
  'users.col.phone':        'Phone',
  'users.col.country':      'Country',
  'users.col.role':         'Role',
  'users.col.actions':      'Actions',
  'users.empty':            'No users registered.',
  'users.loadError':        'Error loading users',
  'users.confirmDelete':    'Confirm?',
  'users.role.owner':       'Owner',
  'users.role.admin':       'Admin',
  'users.role.customer':    'Customer',

  // Users — CreateUserModal
  'users.create.title':     'Add user',
  'users.create.submit':    'Create user',
  'users.create.creating':  'Creating...',
  'users.create.success':   'User created successfully',
  'users.create.oneTime':   'This password is shown only once. Copy it before closing.',
  'users.create.error':     'Error creating user',

  // Users — EditUserModal
  'users.edit.title':       'Edit user',
  'users.edit.submit':      'Save changes',
  'users.edit.saving':      'Saving...',
  'users.edit.error':       'Error updating user',

  // Users — form field labels
  'users.field.name':       'Name',
  'users.field.email':      'Email',
  'users.field.phone':      'Phone',
  'users.field.country':    'Country',
  'users.field.role':       'Role',

  // Users — validation errors
  'users.val.nameRequired': 'Name is required',
  'users.val.emailRequired':'Email is required',
  'users.val.emailInvalid': 'Enter a valid email',
  'users.val.phoneRequired':'Phone is required',
  'users.val.phoneInvalid': 'Digits only',

  // Users — placeholders
  'users.ph.name':          'Full name',
  'users.ph.email':         'email@example.com',
  'users.ph.phone':         'Digits only',

  // Channex
  'channex.manager':        'Channex Channel Manager',
  'channex.propertyHub':    'Migo App · Property Hub',
  'channex.tab.properties': 'Properties',
  'channex.tab.airbnb':     'Airbnb',
  'channex.tab.booking':    'Booking.com',

  // Airbnb
  'airbnb.integration':     'Airbnb Integration',
  'airbnb.shell':           'Migo App · Airbnb',
};
