/**
 * SWING REVIEW INTAKE SCRIPT
 * ---------------------------------------------------------
 * What this does, every time a student submits their swing:
 *   1. Verifies the payment actually went through (via Stripe)
 *   2. Saves BOTH videos (down-the-line + face-on) into a folder
 *      in the pro's own Drive
 *   3. Saves a small info.txt the review tool auto-fills from
 *   4. Logs a new row in a Google Sheet (name, email, phone,
 *      payment status, both video links, review status, Stripe debug)
 *   5. Emails the pro a heads-up that a new submission arrived
 *
 * UPLOAD SHAPE -- two supported flows
 * ---------------------------------------------------------
 * NEW (widget-upload.js): one video per request, then a finalize
 * call. Sending both videos in a single POST put ~107MB of base64
 * on the wire and got the request severed at the transport layer,
 * which the browser reported as a bare "failed to fetch".
 *
 *   POST 1 -> { action: 'video', slot: 'DTL', ... } returns { link, prefix }
 *   POST 2 -> { action: 'video', slot: 'FO', prefix, ... } returns { link }
 *   POST 3 -> { action: 'finalize', prefix, links, student info }
 *
 * OLD (widget-demo.html): everything in one POST, no `action` field.
 * Still works -- see handleLegacySubmission_.
 *
 * SETUP (one-time, ~10 minutes):
 *   1. Go to script.google.com -> New project. Paste this whole
 *      file in, replacing the default code.
 *   2. Fill in the values in the CONFIG block below.
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
  // NOTE: no leading/trailing spaces. Stray spaces get concatenated into
  // the Authorization header and Stripe answers 401, which shows up as
  // every submission logging "NOT confirmed".
  STRIPE_SECRET_KEY: 'PASTE_YOUR_STRIPE_SECRET_KEY_HERE',

  // Where you want to receive the "new submission" email.
  PRO_EMAIL: 'swingtest100@gmail.com',

  // Name of the Drive folder where videos get saved.
  // The script creates this folder automatically if it doesn't exist yet.
  DRIVE_FOLDER_NAME: 'Swing Review Submissions',

  // Name of the Sheet (spreadsheet) used as your submissions log.
  // The script creates this automatically if it doesn't exist yet.
  SHEET_NAME: 'Swing Review Submissions',

  // Where your review tool lives. The notification email links straight
  // to it with ?id=<prefix>, which opens that student's submission with
  // both videos and their contact details already loaded.
  REVIEW_TOOL_URL: 'https://swing-doc.github.io/glen-davis-golf-site/review-tool.html',

  // Shared secret guarding the read side (doGet). It's carried in the
  // review link inside your email, so you never type it. Change it to
  // any random string you like -- if you do, old emailed links stop
  // working, which is the point.
  ACCESS_KEY: 'PASTE_A_RANDOM_STRING_HERE'
};
// =======================================================================


/**
 * Serves a saved submission back to review-tool.html.
 *
 *   ?key=<secret>&id=<prefix>&part=meta               -> name, email, phone
 *   ?key=<secret>&id=<prefix>&part=video&slot=DTL|FO  -> one video as base64
 *
 * Every request needs the key. Without it, anyone could pull a student's
 * videos just by guessing a prefix, and prefixes are only a date, a time
 * and a name. The key travels in the review link inside the pro's email,
 * so it costs the pro nothing.
 *
 * Split into separate calls on purpose: returning both videos in one
 * response would rebuild the oversized-payload problem that the upload
 * side was just fixed to avoid.
 */
function doGet(e) {
  try {
    var params = e.parameter || {};

    if (params.key !== CONFIG.ACCESS_KEY) {
      return jsonResponse_({ ok: false, error: 'not authorised' });
    }

    var id = params.id;
    if (!id) return jsonResponse_({ ok: false, error: 'no id given' });

    if (params.part === 'meta') return getSubmissionMeta_(id);
    if (params.part === 'video') return getSubmissionVideo_(id, params.slot);

    return jsonResponse_({ ok: false, error: 'unknown part' });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}


/** Finds the first file in the submissions folder whose name starts with `start`. */
function findFileStartingWith_(start) {
  var files = getSubmissionsFolder_().getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (file.getName().indexOf(start) === 0) return file;
  }
  return null;
}


function getSubmissionMeta_(id) {
  var file = findFileStartingWith_(id + '_info.txt');
  if (!file) return jsonResponse_({ ok: false, error: 'no info file for ' + id });

  var text = file.getBlob().getDataAsString();
  var out = { ok: true };
  text.split('\n').forEach(function (line) {
    var m = line.match(/^\s*(Name|Email|Phone|Goal)\s*:\s*(.*)$/i);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  });
  return jsonResponse_(out);
}


function getSubmissionVideo_(id, slot) {
  var tag = slot === 'FO' ? 'FaceOn' : 'DownTheLine';
  var file = findFileStartingWith_(id + '_' + tag + '_');
  if (!file) return jsonResponse_({ ok: false, error: 'no ' + tag + ' video for ' + id });

  var blob = file.getBlob();
  return jsonResponse_({
    ok: true,
    fileName: file.getName(),
    mimeType: blob.getContentType(),
    base64: Utilities.base64Encode(blob.getBytes())
  });
}


function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // New split-upload flow: one video per request, then a finalize call.
    if (data.action === 'video') return handleVideoUpload_(data);
    if (data.action === 'finalize') return handleFinalize_(data);

    // No action field = the original all-in-one request. Still supported.
    return handleLegacySubmission_(data);

  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}


/**
 * Saves ONE video. The first call (no prefix sent) generates the shared
 * filename stem and returns it; the widget passes that same prefix back on
 * the second video and on finalize, so all three files for a submission
 * carry matching names.
 */
function handleVideoUpload_(data) {
  var prefix = data.prefix;
  if (!prefix) {
    var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmm');
    var cleanName = (data.studentName || 'student').replace(/[^a-z0-9]/gi, '_');
    prefix = timestamp + '_' + cleanName;
  }

  var tag = data.slot === 'FO' ? 'FaceOn' : 'DownTheLine';
  var link = saveVideoWithPrefix_(data.videoBase64, data.fileName, data.mimeType, prefix, tag);

  return jsonResponse_({ ok: true, prefix: prefix, link: link });
}


/**
 * Runs after both videos are safely in Drive: verifies payment, writes the
 * info.txt the review tool auto-fills from, logs the row, emails the pro.
 * The video links come back from the widget rather than being looked up,
 * which keeps this stateless.
 */
function handleFinalize_(data) {
  var stripeCheck = verifyStripePayment_(data.paymentReference);

  saveInfoFileWithPrefix_(data.prefix, data.studentName, data.studentEmail, data.studentPhone, data.studentGoal);

  appendSubmissionRow_({
    name: data.studentName || '',
    email: data.studentEmail || '',
    phone: data.studentPhone || '',
    goal: data.studentGoal || '',
    paid: stripeCheck.paid,
    debugInfo: stripeCheck.debugInfo,
    dtlLink: data.dtlLink || '',
    foLink: data.foLink || '',
    status: 'Pending'
  });

  notifyPro_(data.studentName, data.studentEmail, data.studentPhone, stripeCheck.paid, data.dtlLink, data.foLink, data.prefix, data.studentGoal);

  return jsonResponse_({ ok: true, paid: stripeCheck.paid });
}


/** The original all-in-one path, unchanged. Kept for older widget pages. */
function handleLegacySubmission_(data) {
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmm');
  var cleanName = (data.studentName || 'student').replace(/[^a-z0-9]/gi, '_');

  var stripeCheck = verifyStripePayment_(data.paymentReference);

  var dtlLink = saveVideoToDrive_(data.videoDTLBase64, data.fileNameDTL, data.mimeTypeDTL, timestamp, cleanName, 'DownTheLine');
  var foLink = saveVideoToDrive_(data.videoFOBase64, data.fileNameFO, data.mimeTypeFO, timestamp, cleanName, 'FaceOn');

  saveInfoFileToDrive_(timestamp, cleanName, data.studentName, data.studentEmail, data.studentPhone);

  appendSubmissionRow_({
    name: data.studentName || '',
    email: data.studentEmail || '',
    phone: data.studentPhone || '',
    paid: stripeCheck.paid,
    debugInfo: stripeCheck.debugInfo,
    dtlLink: dtlLink,
    foLink: foLink,
    status: 'Pending'
  });

  notifyPro_(data.studentName, data.studentEmail, data.studentPhone, stripeCheck.paid, dtlLink, foLink, timestamp + '_' + cleanName);

  return jsonResponse_({ ok: true, paid: stripeCheck.paid });
}


function verifyStripePayment_(paymentReference) {
  if (!paymentReference) return { paid: false, debugInfo: 'No paymentReference was sent from the widget at all.' };
  try {
    var url = 'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(paymentReference);
    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + String(CONFIG.STRIPE_SECRET_KEY).trim() },
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    var bodyText = response.getContentText();
    var session = JSON.parse(bodyText);
    var paid = session.payment_status === 'paid';

    // Deliberately NOT the raw response. The full session object carries
    // the student's billing name, email and address, and 400 characters
    // of it stretched the sheet row to ten lines tall. These four fields
    // are what actually diagnose a failure; on an error Stripe puts the
    // reason in error.message, so that gets kept too.
    var debugInfo = 'HTTP ' + code +
      ' | payment_status=' + session.payment_status +
      ' | amount_total=' + session.amount_total +
      ' | session=' + (session.id || '-');
    if (session.error && session.error.message) {
      debugInfo += ' | error: ' + session.error.message;
    }

    return { paid: paid, debugInfo: debugInfo };
  } catch (err) {
    return { paid: false, debugInfo: 'Threw an error: ' + err };
  }
}


function getSubmissionsFolder_() {
  var folders = DriveApp.getFoldersByName(CONFIG.DRIVE_FOLDER_NAME);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(CONFIG.DRIVE_FOLDER_NAME);
}


function saveVideoWithPrefix_(base64Data, fileName, mimeType, prefix, tag) {
  if (!base64Data) return '';
  var folder = getSubmissionsFolder_();
  var finalName = prefix + '_' + (tag || 'video') + '_' + (fileName || 'swing.mp4');

  var bytes = Utilities.base64Decode(base64Data);
  var blob = Utilities.newBlob(bytes, mimeType || 'video/mp4', finalName);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}


function saveInfoFileWithPrefix_(prefix, studentName, studentEmail, studentPhone, studentGoal) {
  var folder = getSubmissionsFolder_();

  // Goal goes last and on one line: the review tool parses this file
  // line by line, so a multi-line answer in the middle would swallow
  // the fields after it.
  var contents =
    'Name: ' + (studentName || '') + '\n' +
    'Email: ' + (studentEmail || '') + '\n' +
    'Phone: ' + (studentPhone || '') + '\n' +
    'Goal: ' + String(studentGoal || '').replace(/[\r\n]+/g, ' ') + '\n';

  var blob = Utilities.newBlob(contents, 'text/plain', prefix + '_info.txt');
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}


function saveVideoToDrive_(base64Data, fileName, mimeType, timestamp, cleanName, tag) {
  if (!base64Data) return '';
  var folders = DriveApp.getFoldersByName(CONFIG.DRIVE_FOLDER_NAME);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(CONFIG.DRIVE_FOLDER_NAME);

  var finalName = timestamp + '_' + cleanName + '_' + (tag || 'video') + '_' + (fileName || 'swing.mp4');

  var bytes = Utilities.base64Decode(base64Data);
  var blob = Utilities.newBlob(bytes, mimeType || 'video/mp4', finalName);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}


function saveInfoFileToDrive_(timestamp, cleanName, studentName, studentEmail, studentPhone) {
  var folders = DriveApp.getFoldersByName(CONFIG.DRIVE_FOLDER_NAME);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(CONFIG.DRIVE_FOLDER_NAME);

  var finalName = timestamp + '_' + cleanName + '_info.txt';
  var contents =
    'Name: ' + (studentName || '') + '\n' +
    'Email: ' + (studentEmail || '') + '\n' +
    'Phone: ' + (studentPhone || '') + '\n';

  var blob = Utilities.newBlob(contents, 'text/plain', finalName);
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
    row.goal || '',
    row.paid ? 'Paid' : 'NOT confirmed',
    row.dtlLink,
    row.foLink,
    row.status,
    row.debugInfo
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
    sheet.appendRow(['Timestamp', 'Name', 'Email', 'Phone', 'What They Want Looked At', 'Payment', 'Down-the-Line Link', 'Face-On Link', 'Review Status', 'Stripe Debug Info']);
    sheet.setFrozenRows(1);
  }
  return ss.getSheets()[0];
}


function notifyPro_(name, email, phone, paid, dtlLink, foLink, prefix, goal) {
  var subject = (paid ? 'New paid submission' : 'New submission -- payment NOT confirmed') + ' from ' + (name || 'a student');

  var reviewLink = prefix
    ? CONFIG.REVIEW_TOOL_URL + '?id=' + encodeURIComponent(prefix) +
      '&key=' + encodeURIComponent(CONFIG.ACCESS_KEY)
    : '';

  var body =
    'Name: ' + (name || '-') + '\n' +
    'Email: ' + (email || '-') + '\n' +
    'Phone: ' + (phone || '-') + '\n' +
    'Payment: ' + (paid ? 'Confirmed paid' : 'NOT confirmed -- check before reviewing') + '\n\n' +
    'What they want looked at:\n' + (goal ? goal : '(they did not say)') + '\n\n' +
    (reviewLink ? 'START THE REVIEW (opens with both videos loaded):\n' + reviewLink + '\n\n' : '') +
    'Or open the raw files in Drive:\n' +
    'Down-the-line video: ' + (dtlLink || '(not attached)') + '\n' +
    'Face-on video: ' + (foLink || '(not attached)') + '\n\n' +
    'This was logged automatically in your ' + CONFIG.SHEET_NAME + ' sheet.';
  MailApp.sendEmail(CONFIG.PRO_EMAIL, subject, body);
}


function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
