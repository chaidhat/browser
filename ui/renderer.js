const urlBar = document.getElementById('url-bar');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const reloadBtn = document.getElementById('reload-btn');

// Navigate on Enter
urlBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const value = urlBar.value.trim();
    if (value) {
      window.browser.navigate(value);
      urlBar.blur();
    }
  }
});

// Select all text on focus
urlBar.addEventListener('focus', () => {
  urlBar.select();
});

// Navigation buttons
backBtn.addEventListener('click', () => window.browser.goBack());
forwardBtn.addEventListener('click', () => window.browser.goForward());
reloadBtn.addEventListener('click', () => window.browser.reload());

// Listen for URL changes from main process
window.browser.onUrlChanged((url) => {
  urlBar.value = url;
});

// Loading indicator
window.browser.onLoading((loading) => {
  if (loading) {
    urlBar.classList.add('loading');
  } else {
    urlBar.classList.remove('loading');
  }
});

// Update title
window.browser.onTitleChanged((title) => {
  document.title = title;
});
