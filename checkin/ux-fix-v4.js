(() => {
  const search = document.querySelector('#guestSearch');
  const suggestions = document.querySelector('#searchSuggestions');
  const clearPopup = () => {
    if (!suggestions || !search) return;
    suggestions.hidden = true;
    search.setAttribute('aria-expanded', 'false');
    search.removeAttribute('aria-activedescendant');
  };
  document.addEventListener('click', (e) => {
    if (e.target.closest('#sheetClose, #sheetBackdrop, .arrive-all')) {
      setTimeout(clearPopup, 320);
    }
  });
})();
