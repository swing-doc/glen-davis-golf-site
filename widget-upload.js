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
var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyHUgeRd39Zr91-1NP_EcydAaRbn8IZEHACTMH3wd7QhI2X1G3j1KH2HYn6tXCoVbI/exec';
var PAY_LINK_URL = 'https://buy.stripe.com/test_8x24gs1oidEU3EZ1hRg3600';
var MAX_FILE_MB = 40; // keep uploads reasonable -- base64 adds ~33% overhead
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
    if (errorEl) errorEl.classList.add('show');
    return;
  }
  if (errorEl) errorEl.classList.remove('show');

  var tooBig = [dtlFile, foFile].some(function (f) { return f.size > MAX_FILE_MB * 1024 * 1024; });
  if (tooBig) {
    if (errorEl) {
      errorEl.textContent = 'One of those videos is a bit large -- please keep each under ' + MAX_FILE_MB + 'MB.';
      errorEl.classList.add('show');
    }
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Uploading…';

  fileToBase64_(dtlFile, function (dtlBase64) {
    fileToBase64_(foFile, function (foBase64) {
      var payload = {
        studentName: (nameField && nameField.value.trim()) || '',
        studentEmail: email,
        studentPhone: (phoneField && phoneField.value.trim()) || '',
        paymentReference: paymentReference,
        fileNameDTL: dtlFile.name,
        mimeTypeDTL: dtlFile.type || 'video/mp4',
        videoDTLBase64: dtlBase64,
        fileNameFO: foFile.name,
        mimeTypeFO: foFile.type || 'video/mp4',
        videoFOBase64: foBase64
      };

      // Sent as text/plain to avoid a CORS preflight request, which
      // Apps Script Web Apps don't handle. The script itself still
      // parses this as JSON on the other end.
      fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      })
        .then(function (res) { return res.json(); })
        .then(function (result) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit My Swing';
          if (result.ok) {
            var panel2 = document.getElementById('swrPanel2');
            var panel3 = document.getElementById('swrPanel3');
            if (panel2 && panel3) {
              panel2.classList.remove('active');
              panel3.classList.add('active');
            }
          } else if (errorEl) {
            errorEl.textContent = 'Something went wrong on our end -- please try again or contact us directly.';
            errorEl.classList.add('show');
          }
        })
        .catch(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit My Swing';
          if (errorEl) {
            errorEl.textContent = "Couldn't reach the server -- check your connection and try again.";
            errorEl.classList.add('show');
          }
        });
    });
  });
}


function fileToBase64_(file, callback) {
  var reader = new FileReader();
  reader.onload = function () {
    // result looks like "data:video/mp4;base64,AAAA..." -- strip the prefix
    var result = reader.result;
    var base64 = result.substring(result.indexOf(',') + 1);
    callback(base64);
  };
  reader.readAsDataURL(file);
}
