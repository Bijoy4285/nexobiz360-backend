//﻿ Nexobiz360 branded email templates
// All emails include the app logo, name, and a consistent design.

const APP_URL = process.env.APP_URL || "https://weavestackit.online";
const LANDING_URL = process.env.LANDING_URL || "https://nexobiz360.weavestackit.online";

const BRAND = {
  name: "Nexobiz360",
  tagline: "Smarter Business. Stronger Tomorrow.",
  accent: "#f97316",
  accent2: "#ea580c",
  logoMark: "N",
  logoUrl: "https://weavestackit.online/nexobiz360-logo.png",
  site: LANDING_URL,
  checkoutUrl: LANDING_URL,
  dashboardUrl: LANDING_URL,
  supportUrl: LANDING_URL
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
        'You received this email because you have an account with <strong style="color:#9db2e8;"> Nexobiz360</strong>.<br>' +
        '© ' + new Date().getFullYear() + '  Nexobiz360. All rights reserved.<br>' +
        '<a href="' + BRAND.site + '" style="color:#84cc16;text-decoration:none;">Visit  Nexobiz360</a>' +
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
    title: 'Welcome to  Nexobiz360, ' + (name || 'there') + '! 👋',
    subtitle: 'Your account has been created successfully.',
    body: '<p>Hi <strong>' + (name || 'friend') + '</strong>,</p>' +
      '<p>Thank you for joining <strong> Nexobiz360</strong>. Your account is ready.</p>' +
      '<p style="margin-top:14px;">Here is your account summary:</p>' +
      '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;font-size:13px;color:#334155;"><tr><td style="padding:4px 0;">Email</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + (email || '—') + '</td></tr></table>' +
      '<p style="margin-top:16px;">You can now explore your dashboard, manage your store, and grow your business.</p>',
    actionUrl: BRAND.site,
    actionLabel: 'Go to  Nexobiz360'
  });
}

function thanksEmail(name, storeName) {
  return renderEmail({
    title: 'Thank You! 🙏',
    subtitle: 'We appreciate you choosing  Nexobiz360' + (storeName ? ' for ' + storeName : '') + '.',
    body: '<p>Dear <strong>' + (name || 'there') + '</strong>,</p>' +
      '<p>Thank you for using <strong> Nexobiz360</strong>. We are excited to be part of your journey.</p>' +
      '<p>Our team reviews every submission carefully and will get back to you within 24 hours. For any questions, just reply to this email.</p>',
    actionUrl: BRAND.site,
    actionLabel: 'Visit Your App'
  });
}

function notificationEmail(subject, message) {
  return renderEmail({
    title: subject || ' Nexobiz360 Notification',
    body: '<p>' + (message || '') + '</p>',
    actionUrl: BRAND.site,
    actionLabel: 'Open  Nexobiz360'
  });
}

function storeLiveEmail(name, storeName) {
  return renderEmail({
    title: '🎉 Your Store is LIVE!',
    subtitle: (storeName || 'Your store') + ' is now live on  Nexobiz360.',
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
      '<p>Thank you for registering <strong>' + (storeName || 'your store') + '</strong> on  Nexobiz360.</p>' +
      '<p>Your payment has been submitted successfully and is now with our verification team.</p>' +
      '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;font-size:13px;color:#334155;">' +
        '<tr><td style="padding:4px 0;">Store</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + (storeName || '—') + '</td></tr>' +
        '<tr><td style="padding:4px 0;">Payment ID</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + (paymentId || '—') + '</td></tr>' +
        '<tr><td style="padding:4px 0;">Status</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#f59e0b;">⏳ Under review</td></tr>' +
      '</table>' +
      '<p style="margin-top:16px;">Once approved, your store and website go live automatically. We\u2019ll notify you by email within 24 hours.</p>',
    actionUrl: BRAND.site,
    actionLabel: 'Go to  Nexobiz360'
  });
}

function adminAlertEmail(subject, detailsHtml) {
  return renderEmail({
    title: subject || ' Nexobiz360 Admin Alert',
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
    actionLabel: 'Back to  Nexobiz360'
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
    actionLabel: 'Back to  Nexobiz360'
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
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Your  Nexobiz360 subscription is about to expire on <strong>' + expiryDate + '</strong>.</p>' +
      '<div style="text-align:center;margin:18px 0;">' + badge(label, urgency) + '</div>' +
      (amount ? summaryTable([['Plan renewal', ' Nexobiz360 Pro'], ['Amount due', amount + ' TK']]) : summaryTable([['Subscription expires', expiryDate]])) +
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
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Your  Nexobiz360 subscription expired on <strong>' + expiryDate + '</strong>. Some modules may have been paused.</p>' +
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
      '<p style="color:#475569;font-size:13px;margin-top:18px;">Thank you for staying with  Nexobiz360.</p>',
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
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Great news — you are now a member of <strong>' + (storeName || 'our store') + '</strong> on  Nexobiz360.</p>' +
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
    title: isAdmin ? 'You are now an  Nexobiz360 Admin' : 'Your Admin Access Has Been Removed',
    subtitle: isAdmin ? 'Your account has been promoted to Administrator.' : 'Your account has been changed to a standard user.',
    body:
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Hi <strong>' + (name || 'there') + '</strong>,</p>' +
      (isAdmin
        ? '<p style="color:#475569;font-size:14px;line-height:1.6;">Congratulations! Your account has been granted <strong>Administrator</strong> access to  Nexobiz360. You can now manage users, approve payments, view platform stats, and control the platform.</p>'
        : '<p style="color:#475569;font-size:14px;line-height:1.6;">Your <strong>Administrator</strong> access has been removed. You now have a standard user account with the modules assigned to you.</p>') +
      '<div style="text-align:center;margin:18px 0;">' + badge(isAdmin ? 'Administrator' : 'Standard user', isAdmin ? '#2563eb' : '#64748b') + '</div>' +
      '<p style="color:#475569;font-size:14px;line-height:1.6;">If you did not expect this change, please contact the  Nexobiz360 team.</p>',
    actionUrl: BRAND.dashboardUrl,
    actionLabel: 'Go to Dashboard'
  });
}

function planUpdatedEmail(name, plan, expiryDate, amount) {
  var paid = String(plan).toLowerCase() !== 'free';
  return renderEmail({
    title: 'Your Plan Has Been Updated',
    subtitle: 'Your  Nexobiz360 plan has been changed to ' + plan + '.',
    body:
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Hi <strong>' + (name || 'there') + '</strong>,</p>' +
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Your account plan has been updated to <strong>' + plan + '</strong>.</p>' +
      '<div style="text-align:center;margin:18px 0;">' + badge(plan + (paid ? '' : ''), paid ? '#16a34a' : '#64748b') + '</div>' +
      summaryTable([
        ['Current plan', plan || '—'],
        ['Expires on', expiryDate || (paid ? '—' : 'No expiry')]
      ]) +
      '<p style="color:#475569;font-size:14px;line-height:1.6;margin-top:18px;">' + (paid
        ? 'You now have access to all features in your ' + plan + ' plan. Thank you for choosing  Nexobiz360!'
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
        ['Plan', planLabel || ' Nexobiz360 Pro'],
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
function passwordResetEmail(name, resetUrl) {
  return renderEmail({
    title: 'Reset Your Password',
    subtitle: 'We received a request to reset your  Nexobiz360 password.',
    body:
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Hi <strong>' + (name || 'there') + '</strong>,</p>' +
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Click the button below to choose a new password for your  Nexobiz360 account.</p>' +
      '<div style="text-align:center;margin:18px 0;">' + badge('Valid for 30 minutes', '#d97706') + '</div>' +
      '<p style="color:#94a3b8;font-size:12px;line-height:1.6;margin-top:20px;">If you did not request a password reset, you can safely ignore this email — your password will remain unchanged.</p>' +
      '<p style="color:#94a3b8;font-size:12px;line-height:1.6;margin-top:10px;">If the button above doesn\'t work, copy and paste this link into your browser:<br>' +
      '<a href="' + resetUrl + '" style="color:#2563eb;word-break:break-all;">' + resetUrl + '</a></p>',
    actionUrl: resetUrl,
    actionLabel: 'Reset My Password'
  });
}

function passwordChangedEmail(name) {
  return renderEmail({
    title: 'Your Password Was Changed',
    subtitle: 'This is a confirmation that your password has been updated.',
    body:
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Hi <strong>' + (name || 'there') + '</strong>,</p>' +
      '<p style="color:#475569;font-size:14px;line-height:1.6;">Your  Nexobiz360 account password was just changed successfully.</p>' +
      '<div style="text-align:center;margin:18px 0;">' + badge('Password updated', '#16a34a') + '</div>' +
      '<p style="color:#94a3b8;font-size:12px;line-height:1.6;margin-top:20px;">If you did not make this change, please contact our support team immediately to secure your account.</p>',
    actionUrl: BRAND.dashboardUrl,
    actionLabel: 'Go to Dashboard'
  });
}
module.exports = {
  BRAND, renderEmail, welcomeEmail, thanksEmail, notificationEmail, storeRegisteredEmail, adminAlertEmail,
  orderConfirmationEmail, bookingConfirmationEmail, storeLiveEmail, storeRejectedEmail,
  wrapper, btn, badge, summaryTable,
  subscriptionActivatedEmail, subscriptionRenewalReminderEmail, subscriptionExpiredEmail, subscriptionRenewalConfirmedEmail,
   paymentDueEmail, membershipWelcomeEmail, paymentReceiptEmail, accountRoleEmail, planUpdatedEmail,
  passwordResetEmail, passwordChangedEmail
};
