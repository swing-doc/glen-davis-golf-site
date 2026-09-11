/**
 * SWING REVIEW INTAKE SCRIPT
 * ---------------------------------------------------------
 * What this does, every time a student submits their swing:
 *   1. Verifies the payment actually went through (via Stripe)
 *   2. Saves BOTH videos (down-the-line + face-on) into a folder
 *      in the pro's own Drive
 *   3. Logs a new row in a Google Sheet (name, email, phone,
 *      payment status, both video links, review status)
 *   4. Emails the pro a heads-up that a new submission arrived
 *
 * SETUP (one-time, ~10 minutes):
 *   1. Go to script.google.com -> New project. Paste this whole
 *      file in, replacing the default code.
 *   2. Fill in the 5 values in the CONFIG block below.
 *   3. Click Deploy -> New deployment -> type: "Web app".
 *        - Execute as: Me
 *        - Who has access: Anyone
 *      Click Deploy, then authorize when prompted.
 *   4. Copy the Web App URL it gives you -- that's the address
 *      your site's upload widget will send submissions to.
 */

// ====================== CONFIG -- fill these in ======================
var CONFIG = {
  // Your Stripe secret key (starts with sk_live_ or sk_test_).
  // Find it at dashboard.stripe.com -> Developers -> API keys.
  STRIPE_SECRET_KEY: 'PASTE_YOUR_STRIPE_SECRET_KEY_HERE',

  // Where you want to receive the "new submission" email.
  PRO_EMAIL: 'you@example.com',

  // Name of the Drive folder where videos get saved.
  // The script creates this folder automatically if it doesn't exist yet.
  DRIVE_FOLDER_NAME: 'Swing Review Submissions',

  // Name of the Sheet (spreadsheet) used as your submissions log.
  // The script creates this automatically if it doesn't exist yet.
  SHEET_NAME: 'Swing Review Submissions'
};
// =======================================================================


function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // ---- 1. Verify payment with Stripe ----
    var paymentOk = verifyStripePayment_(data.paymentReference);

    // ---- 2. Save both videos into Drive ----
    var dtlLink = saveVideoToDrive_(data.videoDTLBase64, data.fileNameDTL, data.mimeTypeDTL, data.studentName, 'DownTheLine');
    var foLink = saveVideoToDrive_(data.videoFOBase64, data.fileNameFO, data.mimeTypeFO, data.studentName, 'FaceOn');

    // ---- 3. Log a row in the Sheet ----
    appendSubmissionRow_({
      name: data.studentName || '',
      email: data.studentEmail || '',
      phone: data.studentPhone || '',
      paid: paymentOk,
      dtlLink: dtlLink,
      foLink: foLink,
      status: 'Pending'
    });

    // ---- 4. Notify the pro ----
    notifyPro_(data.studentName, data.studentEmail, data.studentPhone, paymentOk, dtlLink, foLink);

    return jsonResponse_({ ok: true, paid: paymentOk });

  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}


function verifyStripePayment_(paymentReference) {
  if (!paymentReference) return false;
  try {
    var url = 'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(paymentReference);
    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + CONFIG.STRIPE_SECRET_KEY },
      muteHttpExceptions: true
    });
    var session = JSON.parse(response.getContentText());
    return session.payment_status === 'paid';
  } catch (err) {
    return false;
  }
}


function saveVideoToDrive_(base64Data, fileName, mimeType, studentName, tag) {
  if (!base64Data) return '';
  var folders = DriveApp.getFoldersByName(CONFIG.DRIVE_FOLDER_NAME);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(CONFIG.DRIVE_FOLDER_NAME);

  var cleanName = (studentName || 'student').replace(/[^a-z0-9]/gi, '_');
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmm');
  var finalName = timestamp + '_' + cleanName + '_' + (tag || 'video') + '_' + (fileName || 'swing.mp4');

  var bytes = Utilities.base64Decode(base64Data);
  var blob = Utilities.newBlob(bytes, mimeType || 'video/mp4', finalName);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}


function appendSubmissionRow_(row) {
  var sheet = getOrCreateSheet_();
  sheet.appendRow([
    new Date(),
    row.name,
    row.email,
    row.phone,
    row.paid ? 'Paid' : 'NOT confirmed',
    row.dtlLink,
    row.foLink,
    row.status
  ]);
}


function getOrCreateSheet_() {
  var files = DriveApp.getFilesByName(CONFIG.SHEET_NAME);
  var ss;
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(CONFIG.SHEET_NAME);
    var sheet = ss.getSheets()[0];
    sheet.appendRow(['Timestamp', 'Name', 'Email', 'Phone', 'Payment', 'Down-the-Line Link', 'Face-On Link', 'Review Status']);
    sheet.setFrozenRows(1);
  }
  return ss.getSheets()[0];
}


function notifyPro_(name, email, phone, paid, dtlLink, foLink) {
  var subject = (paid ? 'New paid submission' : 'New submission -- payment NOT confirmed') + ' from ' + (name || 'a student');
  var body =
    'Name: ' + (name || '-') + '\n' +
    'Email: ' + (email || '-') + '\n' +
    'Phone: ' + (phone || '-') + '\n' +
    'Payment: ' + (paid ? 'Confirmed paid' : 'NOT confirmed -- check before reviewing') + '\n' +
    'Down-the-line video: ' + (dtlLink || '(not attached)') + '\n' +
    'Face-on video: ' + (foLink || '(not attached)') + '\n\n' +
    'This was logged automatically in your ' + CONFIG.SHEET_NAME + ' sheet.';
  MailApp.sendEmail(CONFIG.PRO_EMAIL, subject, body);
}


function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
