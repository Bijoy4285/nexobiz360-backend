// Ocean SFT branded email templates
// All emails include the app logo, name, and a consistent design.

const APP_URL = process.env.APP_URL || "https://oceansft.mamglobalcorporation.com";
const BRAND = {
  name: "Ocean SFT",
  tagline: "All-in-one business management",
  accent: "#2563eb",
  accent2: "#0891b2",
  logoMark: "OS",
  logoUrl: "data:image/jpeg;base64,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",
  site: APP_URL + "/locator",
  checkoutUrl: APP_URL + "/account",
  dashboardUrl: APP_URL + "/dashboard",
  supportUrl: APP_URL + "/locator"
};

function logoMarkHtml(bg) {
  var g = bg || 'linear-gradient(135deg,#2563eb 0%,#0891b2 100%)';
if (BRAND.logoUrl) {
    return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;"><tr><td align="center" style="background:#ffffff;border-radius:20px;padding:10px;box-shadow:0 10px 30px rgba(0,0,0,.35);"><img src="' + BRAND.logoUrl + '" alt="' + BRAND.name + '" style="width:140px;max-width:180px;height:auto;display:block;"></td></tr></table>';
  }
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 18px;"><tr><td align="center" style="width:60px;height:60px;background:' + g + ';border-radius:16px;font-family:Arial,sans-serif;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;box-shadow:0 10px 30px rgba(0,0,0,.35);">' + BRAND.logoMark + '</td></tr></table>';
}

function header() {
  return '' +
    '<div style="text-align:center;padding:38px 24px 34px;background:#0f1e3d;">' +
      '<div style="background:radial-gradient(circle at 20% 0%,rgba(37,99,235,.45) 0,transparent 60%),radial-gradient(circle at 90% 100%,rgba(132,204,22,.35) 0,transparent 55%);">' +
        (BRAND.logoUrl ? '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 14px;"><tr><td align="center" style="background:#ffffff;border-radius:20px;padding:10px;box-shadow:0 12px 34px rgba(0,0,0,.4);"><img src="' + BRAND.logoUrl + '" alt="' + BRAND.name + '" style="width:140px;max-width:180px;height:auto;display:block;"></td></tr></table>' : logoMarkHtml()) +
        '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:30px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">' + BRAND.name + '</div>' +
        '<div style="font-family:Arial,sans-serif;font-size:13px;color:#9db2e8;margin-top:6px;letter-spacing:2px;text-transform:uppercase;">' + BRAND.tagline + '</div>' +
      '</div>' +
    '</div>';
}

function footer() {
  return '' +
    '<div style="background:#0f1e3d;padding:26px 24px 30px;text-align:center;">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;"><tr>' +
        '<td style="padding:0 14px;"><a href="' + BRAND.dashboardUrl + '" style="font-family:Arial,sans-serif;font-size:12px;color:#93a5d1;text-decoration:none;">Dashboard</a></td>' +
        '<td style="padding:0 14px;"><a href="' + BRAND.checkoutUrl + '" style="font-family:Arial,sans-serif;font-size:12px;color:#93a5d1;text-decoration:none;">Billing</a></td>' +
        '<td style="padding:0 14px;"><a href="' + BRAND.supportUrl + '" style="font-family:Arial,sans-serif;font-size:12px;color:#93a5d1;text-decoration:none;">Help & Support</a></td>' +
      '</tr></table>' +
      '<div style="font-family:Arial,sans-serif;font-size:12px;color:#64748b;line-height:1.7;">' +
        'You received this email because you have an account with <strong style="color:#9db2e8;">Ocean SFT</strong>.<br>' +
        '© ' + new Date().getFullYear() + ' Ocean SFT. All rights reserved.<br>' +
        '<a href="' + BRAND.site + '" style="color:#84cc16;text-decoration:none;">Visit Ocean SFT</a>' +
      '</div>' +
    '</div>';
}

function wrapper(bodyHtml) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' +
    '<body style="margin:0;padding:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:26px 12px;"><tr><td align="center">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border-radius:22px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 24px 60px rgba(15,30,61,.14);">' +
        '<tr><td>' + header() + '</td></tr>' +
        '<tr><td style="padding:36px 34px;color:#0f1e3d;">' + bodyHtml + '</td></tr>' +
        '<tr><td>' + footer() + '</td></tr>' +
      '</table>' +
    '</td></tr></table></body></html>';
}

function btn(href, label, opts) {
  opts = opts || {};
  var bg = opts.secondary ? '#ffffff' : 'linear-gradient(135deg,#2563eb 0%,#1d4ed8 55%,#4f46e5 100%)';
  var color = opts.secondary ? '#2563eb' : '#ffffff';
  var border = opts.secondary ? 'border:2px solid #2563eb;' : '';
  var shadow = opts.secondary ? '' : 'box-shadow:0 10px 22px rgba(37,99,235,.35);';
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px auto;border-collapse:collapse;"><tr><td align="center" style="border-radius:999px;background:' + bg + ';' + border + ';' + shadow + 'padding:14px 32px;font-family:Arial,sans-serif;font-size:15px;font-weight:700;"><a href="' + href + '" style="color:' + color + ';text-decoration:none;display:inline-block;">' + label + '</a></td></tr></table>';
}

function title(text) {
  return '<h1 style="margin:0 0 8px;font-family:Georgia,\'Times New Roman\',serif;font-size:24px;font-weight:800;color:#0f1e3d;letter-spacing:-0.5px;">' + text + '</h1>';
}

function sub(text) {
  return '<p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:14px;color:#64748b;line-height:1.65;">' + text + '</p>';
}

function divider() {
  return '<div style="height:1px;background:linear-gradient(90deg,transparent,#2563eb,transparent);margin:24px 0;"></div>';
}

function badge(text, color) {
  color = color || '#2563eb';
  var bgMap = { '#16a34a':'#ecfdf5', '#dc2626':'#fef2f2', '#d97706':'#fffbeb', '#2563eb':'#eff6ff', '#64748b':'#f1f5f9', '#84cc16':'#f7fee7' };
  var bg = bgMap[color] || '#eff6ff';
  return '<span style="display:inline-block;background:' + bg + ';color:' + color + ';font-family:Arial,sans-serif;font-size:12px;font-weight:700;padding:6px 14px;border-radius:999px;letter-spacing:0.5px;text-transform:uppercase;">' + text + '</span>';
}

function summaryTable(rows) {
  var html = '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;font-family:Arial,sans-serif;font-size:13px;color:#334155;">';
  rows.forEach(function(r) {
    html += '<tr>' +
      '<td style="padding:12px 18px;border-bottom:1px solid #eef2f7;color:#64748b;width:44%;">' + r[0] + '</td>' +
      '<td style="padding:12px 18px;border-bottom:1px solid #eef2f7;text-align:right;font-weight:700;color:#0f1e3d;">' + r[1] + '</td>' +
    '</tr>';
  });
  html += '</table>';
  return html;
}

/**
 * Full templated email.
 * opts: { title, subtitle, body, actionUrl, actionLabel }
 */
function renderEmail(opts) {
  var body = '';
  if (opts.title) body += title(opts.title);
  if (opts.subtitle) body += sub(opts.subtitle);
  if (opts.body) body += '<div style="font-family:Arial,sans-serif;font-size:14px;color:#334155;line-height:1.7;">' + opts.body + '</div>';
  if (opts.actionUrl && opts.actionLabel) body += btn(opts.actionUrl, opts.actionLabel);
  return wrapper(body);
}

// ============ Prebuilt templates ============
function welcomeEmail(name, email) {
  return renderEmail({
    title: 'Welcome to Ocean SFT, ' + (name || 'there') + '! 👋',
    subtitle: 'Your account has been created successfully.',
    body: '<p>Hi <strong>' + (name || 'friend') + '</strong>,</p>' +
      '<p>Thank you for joining <strong>Ocean SFT</strong>. Your account is ready.</p>' +
      '<p style="margin-top:14px;">Here is your account summary:</p>' +
      '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;font-size:13px;color:#334155;"><tr><td style="padding:4px 0;">Email</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + (email || '—') + '</td></tr></table>' +
      '<p style="margin-top:16px;">You can now explore your dashboard, manage your store, and grow your business.</p>',
    actionUrl: BRAND.site,
    actionLabel: 'Go to Ocean SFT'
  });
}

function thanksEmail(name, storeName) {
  return renderEmail({
    title: 'Thank You! 🙏',
    subtitle: 'We appreciate you choosing Ocean SFT' + (storeName ? ' for ' + storeName : '') + '.',
    body: '<p>Dear <strong>' + (name || 'there') + '</strong>,</p>' +
      '<p>Thank you for using <strong>Ocean SFT</strong>. We are excited to be part of your journey.</p>' +
      '<p>Our team reviews every submission carefully and will get back to you within 24 hours. For any questions, just reply to this email.</p>',
    actionUrl: BRAND.site,
    actionLabel: 'Visit Your App'
  });
}

function notificationEmail(subject, message) {
  return renderEmail({
    title: subject || 'Ocean SFT Notification',
    body: '<p>' + (message || '') + '</p>',
    actionUrl: BRAND.site,
    actionLabel: 'Open Ocean SFT'
  });
}

function storeLiveEmail(name, storeName) {
  return renderEmail({
    title: '🎉 Your Store is LIVE!',
    subtitle: (storeName || 'Your store') + ' is now live on Ocean SFT.',
    body: '<p>Congratulations <strong>' + (name || 'there') + '</strong>!</p>' +
      '<p>Your payment has been approved and <strong>' + (storeName || 'your store') + '</strong> is now live.</p>' +
      '<p>Visitors can now find it on the locator and browse your full website. You can manage everything from your dashboard.</p>' +
      '<p style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:12px;color:#047857;font-size:13px;">✅ Payment approved — store online</p>',
    actionUrl: BRAND.site,
    actionLabel: 'Open Your Dashboard'
  });
}

function storeRejectedEmail(name, storeName, reason) {
  return renderEmail({
    title: 'Store Verification Issue',
    subtitle: 'We could not approve your payment for ' + (storeName || 'your store') + '.',
    body: '<p>Dear <strong>' + (name || 'there') + '</strong>,</p>' +
      '<p>Unfortunately, we could not verify your payment for <strong>' + (storeName || 'your store') + '</strong>.</p>' +
      (reason ? '<p style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px;color:#b91c1c;font-size:13px;">Reason: ' + reason + '</p>' : '') +
      '<p>Please contact us to resolve this and get your store live.</p>',
    actionUrl: BRAND.site,
    actionLabel: 'Contact Support'
  });
}

function storeRegisteredEmail(name, storeName, paymentId) {
  return renderEmail({
    title: 'Thank You, ' + (name || 'there') + '! 🎉',
    subtitle: 'Your store registration is under review.',
    body: '<p>Dear <strong>' + (name || 'friend') + '</strong>,</p>' +
      '<p>Thank you for registering <strong>' + (storeName || 'your store') + '</strong> on Ocean SFT.</p>' +
      '<p>Your payment has been submitted successfully and is now with our verification team.</p>' +
      '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;font-size:13px;color:#334155;">' +
        '<tr><td style="padding:4px 0;">Store</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + (storeName || '—') + '</td></tr>' +
        '<tr><td style="padding:4px 0;">Payment ID</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + (paymentId || '—') + '</td></tr>' +
        '<tr><td style="padding:4px 0;">Status</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#f59e0b;">⏳ Under review</td></tr>' +
      '</table>' +
      '<p style="margin-top:16px;">Once approved, your store and website go live automatically. We\u2019ll notify you by email within 24 hours.</p>',
    actionUrl: BRAND.site,
    actionLabel: 'Go to Ocean SFT'
  });
}

function adminAlertEmail(subject, detailsHtml) {
  return renderEmail({
    title: subject || 'Ocean SFT Admin Alert',
    body: detailsHtml || '<p>An event needs your attention.</p>',
    actionUrl: APP_URL + '/admin',
    actionLabel: 'Open Admin Panel'
  });
}

function orderConfirmationEmail(storeName, customerName, itemsHtml, total, orderId) {
  return renderEmail({
    title: 'Order Confirmed ✅',
    subtitle: storeName + ' has received your order.',
    body: '<p>Hi <strong>' + (customerName || 'there') + '</strong>,</p>' +
      '<p>Thank you! Your order at <strong>' + (storeName || 'the store') + '</strong> has been confirmed.</p>' +
      '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;font-size:13px;color:#334155;">' +
        '<tr><td style="padding:6px 0;font-weight:700;color:#0f1e3d;border-bottom:1px solid #e2e8f0;">Your Order</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#0f1e3d;border-bottom:1px solid #e2e8f0;">#' + (orderId || '').slice(-6).toUpperCase() + '</td></tr>' +
        (itemsHtml || '<tr><td style="padding:6px 0;">Items</td></tr>') +
        '<tr><td style="padding:8px 0;border-top:1px solid #e2e8f0;">Total</td><td style="padding:8px 0;text-align:right;font-weight:800;color:#0f1e3d;border-top:1px solid #e2e8f0;">' + (total || '') + '</td></tr>' +
      '</table>' +
      '<p style="margin-top:16px;">We\u2019re preparing your order now. You\u2019ll get updates as it progresses.</p>',
    actionUrl: BRAND.site,
    actionLabel: 'Back to Ocean SFT'
  });
}

function bookingConfirmationEmail(storeName, customerName, service, bookingDate, bookingTime) {
  return renderEmail({
    title: 'Booking Confirmed 📅',
    subtitle: storeName + ' has confirmed your booking.',
    body: '<p>Hi <strong>' + (customerName || 'there') + '</strong>,</p>' +
      '<p>Your booking at <strong>' + (storeName || 'the store') + '</strong> is confirmed.</p>' +
      '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;font-size:13px;color:#334155;">' +
        (service ? '<tr><td style="padding:4px 0;">Service</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + service + '</td></tr>' : '') +
        '<tr><td style="padding:4px 0;">Date</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + (bookingDate || '—') + '</td></tr>' +
        '<tr><td style="padding:4px 0;">Time</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + (bookingTime || '—') + '</td></tr>' +
      '</table>' +
      '<p style="margin-top:16px;">Please arrive a few minutes early. See you soon!</p>',
    actionUrl: BRAND.site,
    actionLabel: 'Back to Ocean SFT'
  });
}

function subscriptionActivatedEmail(name, months, expiryDate, moduleKeys, moduleNames) {
  var modList = (moduleNames && moduleNames.length ? moduleNames : moduleKeys || []).map(function(m) {
    return '<li style="padding:4px 0;color:#0f1e3d;">' + String(m).replace(/-/g, ' ') + '</li>';
  }).join('');
  return renderEmail({
    title: 'Your Subscription is Active',
    subtitle: 'Welcome aboard, ' + (name || 'there') + '!',
    body:
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Your subscription has been activated and your modules are ready to use.</p>' +
      '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px;font-size:13px;color:#334155;margin:16px 0;">' +
        '<tr><td style="padding:4px 0;">Duration</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#15803d;">' + months + ' month' + (months > 1 ? 's' : '') + '</td></tr>' +
        '<tr><td style="padding:4px 0;">Expires On</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#15803d;">' + expiryDate + '</td></tr>' +
      '</table>' +
      (modList ? '<p style="font-weight:600;color:#0f1e3d;margin-top:16px;">Active Modules:</p><ul style="margin:8px 0;padding-left:20px;">' + modList + '</ul>' : '') +
      '<p style="color:#475569;font-size:13px;margin-top:16px;">You will receive a reminder email before your subscription expires. You can renew anytime from your dashboard.</p>',
    actionUrl: BRAND.site + '/dashboard',
    actionLabel: 'Go to Dashboard'
  });
}

function subscriptionRenewalReminderEmail(name, daysLeft, expiryDate, modules, amount) {
  var urgency = daysLeft <= 3 ? '#dc2626' : daysLeft <= 7 ? '#d97706' : '#2563eb';
  var bgColor = daysLeft <= 3 ? '#fef2f2' : daysLeft <= 7 ? '#fffbeb' : '#eff6ff';
  var borderColor = daysLeft <= 3 ? '#fecaca' : daysLeft <= 7 ? '#fde68a' : '#bfdbfe';
  var label = daysLeft + ' day' + (daysLeft !== 1 ? 's' : '') + ' left';
  return renderEmail({
    title: 'Your Subscription Expires Soon',
    subtitle: 'Renew today to keep your business running without interruption.',
    body:
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Hi <strong>' + (name || 'there') + '</strong>,</p>' +
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Your Ocean SFT subscription is about to expire on <strong>' + expiryDate + '</strong>.</p>' +
      '<div style="text-align:center;margin:18px 0;">' + badge(label, urgency) + '</div>' +
      (amount ? summaryTable([['Plan renewal', 'Ocean SFT Pro'], ['Amount due', amount + ' TK']]) : summaryTable([['Subscription expires', expiryDate]])) +
      '<p style="color:#475569;font-size:14px;line-height:1.6;margin-top:18px;">To avoid losing access to your modules, please renew before the expiry date. After expiry you have a 3-day grace period.</p>',
    actionUrl: BRAND.checkoutUrl,
    actionLabel: 'Pay & Renew Now'
  });
}

function subscriptionExpiredEmail(name, expiryDate) {
  return renderEmail({
    title: 'Your Subscription Has Expired',
    subtitle: 'Renew now to restore full access to your modules.',
    body:
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Hi <strong>' + (name || 'there') + '</strong>,</p>' +
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Your Ocean SFT subscription expired on <strong>' + expiryDate + '</strong>. Some modules may have been paused.</p>' +
      '<div style="text-align:center;margin:18px 0;">' + badge('Subscription expired', '#dc2626') + '</div>' +
      '<p style="color:#475569;font-size:14px;line-height:1.6;">You can renew at any time to regain full access to all your business tools.</p>',
    actionUrl: BRAND.checkoutUrl,
    actionLabel: 'Renew Subscription'
  });
}

function subscriptionRenewalConfirmedEmail(name, months, newExpiryDate) {
  return renderEmail({
    title: 'Subscription Renewed',
    subtitle: 'Thank you for renewing, ' + (name || 'there') + '!',
    body:
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Your subscription has been successfully renewed and all your modules remain active.</p>' +
      '<div style="text-align:center;margin:18px 0;">' + badge('Payment received', '#16a34a') + '</div>' +
      summaryTable([['Extended by', months + ' month' + (months > 1 ? 's' : '')], ['New expiry date', newExpiryDate]]) +
      '<p style="color:#475569;font-size:13px;margin-top:18px;">Thank you for staying with Ocean SFT.</p>',
    actionUrl: BRAND.dashboardUrl,
    actionLabel: 'Go to Dashboard'
  });
}

function paymentDueEmail(name, amount, dueDate, storeName, paymentId, modules) {
  return renderEmail({
    title: 'Action Required: Payment Incomplete',
    subtitle: 'Complete your payment to activate your store.',
    body:
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Hi <strong>' + (name || 'there') + '</strong>,</p>' +
      '<p style="color:#475569;font-size:14px;line-height:1.6;">We received your store registration for <strong>' + (storeName || 'your store') + '</strong>, but your payment has not been completed yet.</p>' +
      '<div style="text-align:center;margin:18px 0;">' + badge('Payment pending', '#d97706') + '</div>' +
      summaryTable([
        ['Store', storeName || '—'],
        ['Modules', modules || '—'],
        ['Amount due', (amount ? amount + ' TK' : '—')],
        ['Due by', dueDate || 'As soon as possible'],
        ['Payment ID', paymentId || '—']
      ]) +
      '<p style="color:#475569;font-size:14px;line-height:1.6;margin-top:18px;">Once your payment is verified, your store and website go live automatically. If you have already paid, kindly ignore this message.</p>',
    actionUrl: BRAND.checkoutUrl,
    actionLabel: 'Complete Payment'
  });
}

function membershipWelcomeEmail(name, storeName, planLabel, expiry, memberCode, price) {
  return renderEmail({
    title: 'Welcome to ' + (storeName || 'the Club') + '!',
    subtitle: 'Your membership has been activated.',
    body:
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Hi <strong>' + (name || 'there') + '</strong>,</p>' +
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Great news — you are now a member of <strong>' + (storeName || 'our store') + '</strong> on Ocean SFT.</p>' +
      '<div style="text-align:center;margin:18px 0;">' + badge('Membership active', '#16a34a') + '</div>' +
      summaryTable([
        ['Membership', planLabel || 'Member'],
        ['Member ID', memberCode || '—'],
        ['Price', price ? price + ' TK' : '—'],
        ['Valid until', expiry || 'Ongoing']
      ]) +
      '<p style="color:#475569;font-size:14px;line-height:1.6;margin-top:18px;">Present your member ID when you visit to enjoy all your benefits.</p>',
    actionUrl: BRAND.site,
    actionLabel: 'View Your Membership'
  });
}

function accountRoleEmail(name, role) {
  var isAdmin = role === 'admin';
  return renderEmail({
    title: isAdmin ? 'You are now an Ocean SFT Admin' : 'Your Admin Access Has Been Removed',
    subtitle: isAdmin ? 'Your account has been promoted to Administrator.' : 'Your account has been changed to a standard user.',
    body:
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Hi <strong>' + (name || 'there') + '</strong>,</p>' +
      (isAdmin
        ? '<p style="color:#475569;font-size:14px;line-height:1.6;">Congratulations! Your account has been granted <strong>Administrator</strong> access to Ocean SFT. You can now manage users, approve payments, view platform stats, and control the platform.</p>'
        : '<p style="color:#475569;font-size:14px;line-height:1.6;">Your <strong>Administrator</strong> access has been removed. You now have a standard user account with the modules assigned to you.</p>') +
      '<div style="text-align:center;margin:18px 0;">' + badge(isAdmin ? 'Administrator' : 'Standard user', isAdmin ? '#2563eb' : '#64748b') + '</div>' +
      '<p style="color:#475569;font-size:14px;line-height:1.6;">If you did not expect this change, please contact the Ocean SFT team.</p>',
    actionUrl: BRAND.dashboardUrl,
    actionLabel: 'Go to Dashboard'
  });
}

function planUpdatedEmail(name, plan, expiryDate, amount) {
  var paid = String(plan).toLowerCase() !== 'free';
  return renderEmail({
    title: 'Your Plan Has Been Updated',
    subtitle: 'Your Ocean SFT plan has been changed to ' + plan + '.',
    body:
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Hi <strong>' + (name || 'there') + '</strong>,</p>' +
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Your account plan has been updated to <strong>' + plan + '</strong>.</p>' +
      '<div style="text-align:center;margin:18px 0;">' + badge(plan + (paid ? '' : ''), paid ? '#16a34a' : '#64748b') + '</div>' +
      summaryTable([
        ['Current plan', plan || '—'],
        ['Expires on', expiryDate || (paid ? '—' : 'No expiry')]
      ]) +
      '<p style="color:#475569;font-size:14px;line-height:1.6;margin-top:18px;">' + (paid
        ? 'You now have access to all features in your ' + plan + ' plan. Thank you for choosing Ocean SFT!'
        : 'Your account is now on the free plan. You can upgrade anytime from the billing page.') + '</p>',
    actionUrl: BRAND.checkoutUrl,
    actionLabel: 'View Your Plan'
  });
}

function paymentReceiptEmail(name, paymentId, amount, planLabel, months, expiryDate, storeName, method) {
  return renderEmail({
    title: 'Payment Receipt & Invoice',
    subtitle: 'Thank you for your payment — here is your official receipt.',
    body:
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Hi <strong>' + (name || 'there') + '</strong>,</p>' +
      '<p style="color:#475569;font-size:14px;line-height:1.6;">We have received and verified your payment. Please find your receipt details below.</p>' +
      '<div style="text-align:center;margin:18px 0;">' + badge('Payment verified', '#16a34a') + '</div>' +
      summaryTable([
        ['Invoice / Payment ID', paymentId || '—'],
        ['Plan', planLabel || 'Ocean SFT Pro'],
        ['Amount paid', (amount ? amount + ' TK' : '—')],
        ['Method', method || 'bKash'],
        ['Duration', months ? months + ' month' + (months > 1 ? 's' : '') : '—'],
        ['Expires on', expiryDate || '—'],
        ['Store', storeName || '—']
      ]) +
      '<p style="color:#475569;font-size:13px;margin-top:18px;">Keep this email for your records. If you have any questions, reply to this email.</p>',
    actionUrl: BRAND.checkoutUrl,
    actionLabel: 'View Your Account'
  });
}

module.exports = {
  BRAND, renderEmail, welcomeEmail, thanksEmail, notificationEmail, storeRegisteredEmail, adminAlertEmail,
  orderConfirmationEmail, bookingConfirmationEmail, storeLiveEmail, storeRejectedEmail,
  wrapper, btn, badge, summaryTable,
  subscriptionActivatedEmail, subscriptionRenewalReminderEmail, subscriptionExpiredEmail, subscriptionRenewalConfirmedEmail,
  paymentDueEmail, membershipWelcomeEmail, paymentReceiptEmail, accountRoleEmail, planUpdatedEmail
};
