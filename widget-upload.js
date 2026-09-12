/**
 * SWING REVIEW WIDGET -- upload logic
 * ---------------------------------------------------------
 * Handles the real submission: after Stripe redirects the student
 * back here, this collects both videos (down-the-line + face-on)
 * plus their info, and sends it to the pro's Apps Script
 * (see apps-script-intake.gs).
 *
 * This is written to match the field IDs used in widget-demo.html:
 *   swrPayBtn, swrPanel1, swrPanel2, swrPanel3,
 *   swrFileDTL, swrFileFO, swrName, swrEmail, swrPhone,
 *   swrSubmitBtn, swrUploadError
 *
 * HOW THE UPLOAD WORKS (changed -- read this)
 * ---------------------------------------------------------
 * Videos are sent ONE PER REQUEST, not both in a single POST.
 * Base64 inflates a file by about a third, and two large clips in
 * one body was enough to get the request severed at the transport
 * layer -- which surfaced in the browser as a bare "failed to
 * fetch" with no HTTP status, i.e. the old
 * "Couldn't reach the server" message.
 *
 * The sequence is now:
 *   POST 1 -> { action: 'video', slot: 'DTL', ... }  returns { link, prefix }
 *   POST 2 -> { action: 'video', slot: 'FO', prefix, ... }  returns { link }
 *   POST 3 -> { action: 'finalize', prefix, links, student info }
 *
 * The `prefix` returned by the first call is the shared filename
 * stem (timestamp + student name). Passing it back on calls 2 and 3
 * is what keeps both videos and the info.txt file named as one
 * matching set, which is what review-tool.html reads.
 *
 * HOW TO USE THIS ON A PRO'S PAGE
 * ---------------------------------------------------------
 * 1. Set up a Stripe Payment Link (dashboard.stripe.com -> Payment
 *    Links -> create one for the $35 review). In its settings, set
 *    the "after payment" redirect to point back to this same page,
 *    e.g.  https://theirsite.com/swing-review?session_id={CHECKOUT_SESSION_ID}
 *    Stripe fills in {CHECKOUT_SESSION_ID} automatically.
 *
 * 2. Fill in APPS_SCRIPT_URL below with the pro's deployed Web App URL,
 *    and PAY_LINK_URL with their Stripe Payment Link.
 *
 * 3. Load this file on the widget page with:
 *      <script src="widget-upload.js"></script>
 *    It replaces the fake test-mode logic in widget-demo.html's own
 *    <script> tag with the real payment-check + real submission.
 */

// ====================== CONFIG -- fill these in ======================
var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzXeuGQuR0KPa4cU7oDmA9vOwnL_eCE3PIkl9NT5HFPxRrr43WbNKLeAIluMV-Lut3E/exec';
var PAY_LINK_URL = 'https://buy.stripe.com/test_8x24gs1oidEU3EZ1hRg3600';

// Per-file cap. Base64 adds ~33%, so 15MB of video becomes ~20MB on
// the wire -- comfortably inside what an Apps Script web app accepts.
// A 10-second phone clip is typically 5-20MB depending on resolution,
// so students shooting in 4K/60 will need to lower their camera setting
// or trim the clip. Raising this much past 20 is asking for the
// transport-level failure this rewrite exists to fix.
var MAX_FILE_MB = 15;
// ======================================================================

document.addEventListener('DOMContentLoaded', function () {
  var panel1 = document.getElementById('swrPanel1');
  var panel2 = document.getElementById('swrPanel2');
  var payBtn = document.getElementById('swrPayBtn');
  var submitBtn = document.getElementById('swrSubmitBtn');

  var paymentReference = getPaymentReferenceFromUrl_();

  if (payBtn && PAY_LINK_URL.indexOf('PASTE_') !== 0) {
    payBtn.href = PAY_LINK_URL;
  }

  // If Stripe just redirected back here with a session id, skip straight
  // to the upload step instead of showing the Pay panel.
  if (paymentReference && panel1 && panel2) {
    panel1.classList.remove('active');
    panel2.classList.add('active');
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', function () {
      handleSubmit_(paymentReference, submitBtn);
    });
  }
});


function getPaymentReferenceFromUrl_() {
  var params = new URLSearchParams(window.location.search);
  return params.get('session_id') || '';
}


function handleSubmit_(paymentReference, submitBtn) {
  var fileDTL = document.getElementById('swrFileDTL');
  var fileFO = document.getElementById('swrFileFO');
  var nameField = document.getElementById('swrName');
  var emailField = document.getElementById('swrEmail');
  var phoneField = document.getElementById('swrPhone');
  var errorEl = document.getElementById('swrUploadError');

  var dtlFile = fileDTL && fileDTL.files && fileDTL.files[0];
  var foFile = fileFO && fileFO.files && fileFO.files[0];
  var email = (emailField && emailField.value.trim()) || '';

  if (!dtlFile || !foFile || !email) {
    showError_(errorEl, 'Please add both videos and your email before submitting.');
    return;
  }
  hideError_(errorEl);

  var oversized = [dtlFile, foFile].filter(function (f) {
    return f.size > MAX_FILE_MB * 1024 * 1024;
  });
  if (oversized.length) {
    showError_(errorEl, 'One of those videos is too large -- please keep each under ' +
      MAX_FILE_MB + 'MB. Trimming the clip to a few seconds, or recording at 1080p ' +
      'instead of 4K, usually does it.');
    return;
  }

  var studentName = (nameField && nameField.value.trim()) || '';
  var studentPhone = (phoneField && phoneField.value.trim()) || '';

  submitBtn.disabled = true;
  setProgress_(submitBtn, 'Uploading video 1 of 2…');

  var sharedPrefix = '';
  var dtlLink = '';
  var foLink = '';

  uploadVideo_(dtlFile, 'DTL', studentName, '')
    .then(function (result) {
      sharedPrefix = result.prefix || '';
      dtlLink = result.link || '';
      setProgress_(submitBtn, 'Uploading video 2 of 2…');
      return uploadVideo_(foFile, 'FO', studentName, sharedPrefix);
    })
    .then(function (result) {
      foLink = result.link || '';
      setProgress_(submitBtn, 'Finishing up…');
      return postJson_({
        action: 'finalize',
        prefix: sharedPrefix,
        studentName: studentName,
        studentEmail: email,
        studentPhone: studentPhone,
        paymentReference: paymentReference,
        dtlLink: dtlLink,
        foLink: foLink
      });
    })
    .then(function () {
      resetButton_(submitBtn);
      var panel2 = document.getElementById('swrPanel2');
      var panel3 = document.getElementById('swrPanel3');
      if (panel2 && panel3) {
        panel2.classList.remove('active');
        panel3.classList.add('active');
      }
    })
    .catch(function (err) {
      resetButton_(submitBtn);
      showError_(errorEl, messageForError_(err));
    });
}


function uploadVideo_(file, slot, studentName, prefix) {
  return fileToBase64_(file).then(function (base64) {
    return postJson_({
      action: 'video',
      slot: slot,
      prefix: prefix,
      studentName: studentName,
      fileName: file.name,
      mimeType: file.type || 'video/mp4',
      videoBase64: base64
    });
  });
}


/**
 * Sent as text/plain to avoid a CORS preflight request, which Apps
 * Script web apps don't handle. The script still parses it as JSON.
 *
 * Failures are separated into three kinds so the student sees
 * something true rather than one catch-all string:
 *   - network:  the request never completed (size, connection, CORS)
 *   - http:     the server answered, but not with 200
 *   - app:      the script ran and reported ok:false
 */
function postJson_(payload) {
  return fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  })
    .catch(function () {
      throw taggedError_('network', 'fetch did not complete');
    })
    .then(function (res) {
      if (!res.ok) {
        throw taggedError_('http', 'server returned HTTP ' + res.status);
      }
      return res.json().catch(function () {
        throw taggedError_('http', 'server returned a non-JSON response');
      });
    })
    .then(function (result) {
      if (!result || !result.ok) {
        throw taggedError_('app', (result && result.error) || 'the script reported a failure');
      }
      return result;
    });
}


function fileToBase64_(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () {
      // result looks like "data:video/mp4;base64,AAAA..." -- strip the prefix
      var result = reader.result;
      resolve(result.substring(result.indexOf(',') + 1));
    };
    // Without this, a failed read left the button stuck on "Uploading…"
    // forever with no message shown.
    reader.onerror = function () {
      reject(taggedError_('read', 'could not read ' + file.name));
    };
    reader.readAsDataURL(file);
  });
}


function taggedError_(kind, detail) {
  var err = new Error(detail);
  err.kind = kind;
  return err;
}


function messageForError_(err) {
  var kind = err && err.kind;
  if (kind === 'read') {
    return "One of those video files couldn't be read -- try picking it again.";
  }
  if (kind === 'network') {
    return "Couldn't reach the server. If the video is close to " + MAX_FILE_MB +
      'MB, try a shorter clip; otherwise check your connection and try again.';
  }
  if (kind === 'http' || kind === 'app') {
    return 'Something went wrong on our end -- please try again, or contact us ' +
      'directly and we\'ll sort it out.';
  }
  return 'Something went wrong -- please try again.';
}


function setProgress_(submitBtn, text) {
  submitBtn.textContent = text;
}


function resetButton_(submitBtn) {
  submitBtn.disabled = false;
  submitBtn.textContent = 'Submit My Swing';
}


function showError_(errorEl, text) {
  if (!errorEl) return;
  errorEl.textContent = text;
  errorEl.classList.add('show');
}


function hideError_(errorEl) {
  if (!errorEl) return;
  errorEl.classList.remove('show');
}
