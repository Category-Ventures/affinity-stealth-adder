// Affinity Stealth Adder - Content Script
(function() {
  'use strict';

  // Prevent duplicate injection
  if (window.affinityStealthAdderLoaded) return;
  window.affinityStealthAdderLoaded = true;

  // Detect page type
  function getPageType() {
    const url = window.location.href;
    if (url.includes('linkedin.com/in/')) {
      return 'linkedin_profile';
    }
    if (window.location.hostname.includes('signa.software') || window.location.hostname.includes('app.signa')) {
      return 'signa';
    }
    return 'website';
  }

  // Create floating button
  async function createFloatingButton() {
    // Don't show on Affinity itself or extension pages
    if (window.location.hostname.includes('affinity.co') ||
        window.location.protocol === 'chrome-extension:') {
      return null;
    }

    // Check if button should be hidden
    const { affinityButtonHidden } = await chrome.storage.sync.get(['affinityButtonHidden']);
    if (affinityButtonHidden) {
      return null;
    }

    const button = document.createElement('button');
    button.id = 'affinity-stealth-btn';

    const pageType = getPageType();
    if (pageType === 'linkedin_profile') {
      button.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        <span>Add Stealth</span>
      `;
      button.title = 'Add as Stealth founder to Affinity (⌘+Shift+A)';
    } else if (pageType === 'signa') {
      button.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        <span>Add Person</span>
      `;
      button.title = 'Add this person to Interesting People (⌘+Shift+A)';
    } else {
      button.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        <span>Add to Affinity</span>
      `;
      button.title = 'Add this company to Affinity (⌘+Shift+A)';
    }

    document.body.appendChild(button);

    // Restore saved position, or use default bottom-right
    const { affinityBtnPosition } = await chrome.storage.sync.get(['affinityBtnPosition']);
    if (affinityBtnPosition) {
      // Clamp to current viewport so it's never off-screen
      const x = Math.min(Math.max(0, affinityBtnPosition.x), window.innerWidth - button.offsetWidth);
      const y = Math.min(Math.max(0, affinityBtnPosition.y), window.innerHeight - button.offsetHeight);
      button.style.left = x + 'px';
      button.style.top = y + 'px';
      button.style.right = 'auto';
      button.style.bottom = 'auto';
    }

    // Make button draggable (also handles click → showNoteModal)
    makeDraggable(button);

    return button;
  }

  // ── Drag-to-move logic ──────────────────────────────────────────
  function makeDraggable(button) {
    let isDragging = false;
    let wasDragged = false;
    let startX, startY, origLeft, origTop;
    const DRAG_THRESHOLD = 5; // px – distinguish click from drag

    button.addEventListener('mousedown', onMouseDown);

    function onMouseDown(e) {
      // Only left-click, ignore if loading
      if (e.button !== 0 || button.classList.contains('loading')) return;

      isDragging = false;
      wasDragged = false;

      // Resolve current position to top/left (in case it's still bottom/right)
      const rect = button.getBoundingClientRect();
      origLeft = rect.left;
      origTop = rect.top;
      startX = e.clientX;
      startY = e.clientY;

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      // Don't preventDefault here — it would kill the click event for normal taps
    }

    function onMouseMove(e) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!isDragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        isDragging = true;
        wasDragged = true;
        button.classList.add('dragging');
        // Switch to absolute top/left positioning
        button.style.right = 'auto';
        button.style.bottom = 'auto';
        e.preventDefault(); // prevent text selection only once we know it's a drag
      }

      // Clamp inside viewport
      let newLeft = origLeft + dx;
      let newTop = origTop + dy;
      const maxLeft = window.innerWidth - button.offsetWidth;
      const maxTop = window.innerHeight - button.offsetHeight;
      newLeft = Math.min(Math.max(0, newLeft), maxLeft);
      newTop = Math.min(Math.max(0, newTop), maxTop);

      button.style.left = newLeft + 'px';
      button.style.top = newTop + 'px';
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      if (isDragging) {
        button.classList.remove('dragging');
        isDragging = false;

        // Persist position
        const rect = button.getBoundingClientRect();
        chrome.storage.sync.set({
          affinityBtnPosition: { x: rect.left, y: rect.top }
        });

        // Reset wasDragged after a tick so the click interceptor can
        // still swallow the drag-end click, but it won't linger and
        // block the *next* real click
        setTimeout(() => { wasDragged = false; }, 0);
      }
    }

    // Single click handler: open modal on normal clicks, ignore after drags
    button.addEventListener('click', (e) => {
      if (wasDragged) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      showNoteModal();
    });
  }

  // Create modal for notes input
  function createModal() {
    const overlay = document.createElement('div');
    overlay.id = 'affinity-modal-overlay';
    overlay.innerHTML = `
      <div id="affinity-modal">
        <div class="affinity-modal-header">
          <span id="affinity-modal-title">Add to Affinity</span>
          <button id="affinity-modal-close">&times;</button>
        </div>
        <div id="affinity-modal-body">
          <div id="affinity-duplicate-warning" style="display: none;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span>This may already exist in Affinity.</span>
            <a id="affinity-duplicate-link" href="#" target="_blank">View existing →</a>
          </div>
          <div class="affinity-list-picker">
            <label>Add to list</label>
            <div class="affinity-list-options">
              <button type="button" class="affinity-list-option selected" data-list="master_deal">Master Deal List</button>
              <button type="button" class="affinity-list-option" data-list="interesting_people">Interesting People</button>
            </div>
          </div>
          <label for="affinity-note-input">Add a note (optional)</label>
          <textarea id="affinity-note-input" placeholder="e.g., Met at demo day, interesting AI startup..."></textarea>
        </div>
        <div class="affinity-modal-footer">
          <button id="affinity-modal-cancel">Cancel</button>
          <button id="affinity-modal-submit">Add to Affinity</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Event listeners
    document.getElementById('affinity-modal-close').addEventListener('click', hideModal);
    document.getElementById('affinity-modal-cancel').addEventListener('click', hideModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) hideModal();
    });

    // List picker toggle
    overlay.querySelectorAll('.affinity-list-option').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.affinity-list-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    return overlay;
  }

  function showNoteModal() {
    let overlay = document.getElementById('affinity-modal-overlay');
    if (!overlay) {
      overlay = createModal();
    }

    const pageType = getPageType();
    const titleMap = { linkedin_profile: 'Add Stealth Founder', signa: 'Add Person from Signa', website: 'Add Company' };
    document.getElementById('affinity-modal-title').textContent = titleMap[pageType] || 'Add to Affinity';

    // Auto-select Interesting People for Signa pages
    if (pageType === 'signa') {
      overlay.querySelectorAll('.affinity-list-option').forEach(b => b.classList.remove('selected'));
      const peopleBtn = overlay.querySelector('.affinity-list-option[data-list="interesting_people"]');
      if (peopleBtn) peopleBtn.classList.add('selected');
    }
    document.getElementById('affinity-note-input').value = '';
    document.getElementById('affinity-duplicate-warning').style.display = 'none';

    overlay.style.display = 'flex';
    document.getElementById('affinity-note-input').focus();

    // Check for duplicates
    checkDuplicate();

    // Set up submit handler
    const submitBtn = document.getElementById('affinity-modal-submit');
    submitBtn.onclick = () => handleAddToAffinity();
  }

  function hideModal() {
    const overlay = document.getElementById('affinity-modal-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  async function checkDuplicate() {
    const pageType = getPageType();
    let data;

    if (pageType === 'linkedin_profile') {
      data = extractLinkedInData();
    } else if (pageType === 'signa') {
      data = extractSignaData();
    } else {
      data = extractWebsiteData();
    }

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'checkDuplicate',
        data: data
      });

      if (response.exists) {
        const warning = document.getElementById('affinity-duplicate-warning');
        const link = document.getElementById('affinity-duplicate-link');
        link.href = response.affinityUrl;
        warning.style.display = 'flex';
      }
    } catch (e) {
      console.log('Duplicate check failed:', e);
    }
  }

  // Extract profile data from LinkedIn page
  function extractLinkedInData() {
    // Primary method: extract from page title (format: "Name | LinkedIn")
    let fullName = null;
    const title = document.title;
    if (title && title.includes(' | LinkedIn')) {
      fullName = title.split(' | LinkedIn')[0].trim();
    }

    const linkedinUrl = window.location.href.split('?')[0];

    return {
      type: 'linkedin_profile',
      fullName,
      linkedinUrl
    };
  }

  // Extract person data from Signa profile
  function extractSignaData() {
    // Try to find the person's name from the profile card
    const nameEl = document.querySelector('h1.text-lg.font-semibold') || document.querySelector('h1');
    const fullName = nameEl ? nameEl.textContent.trim() : null;

    // Try to find LinkedIn URL from the page
    let linkedinUrl = null;
    const linkedinLinks = document.querySelectorAll('a[href*="linkedin.com/in/"]');
    if (linkedinLinks.length > 0) {
      linkedinUrl = linkedinLinks[0].href;
    }

    return {
      type: 'signa',
      fullName,
      linkedinUrl
    };
  }

  // Extract company data from a regular website
  function extractWebsiteData() {
    const hostname = window.location.hostname.replace('www.', '');
    const domain = hostname;

    let companyName = null;

    const ogTitle = document.querySelector('meta[property="og:site_name"]');
    if (ogTitle && ogTitle.content) {
      companyName = ogTitle.content.trim();
    }

    if (!companyName) {
      const title = document.title;
      companyName = title.split(/[\|\-–—:]/)[0].trim();
      if (companyName.length > 50 || companyName.split(' ').length > 5) {
        companyName = null;
      }
    }

    if (!companyName) {
      const domainParts = domain.split('.');
      companyName = domainParts[0].charAt(0).toUpperCase() + domainParts[0].slice(1);
    }

    return {
      type: 'website',
      companyName,
      domain,
      url: window.location.href
    };
  }

  // Handle adding to Affinity
  async function handleAddToAffinity() {
    const button = document.getElementById('affinity-stealth-btn');
    const submitBtn = document.getElementById('affinity-modal-submit');
    const noteInput = document.getElementById('affinity-note-input');
    const pageType = getPageType();

    try {
      // Show loading state
      submitBtn.disabled = true;
      submitBtn.textContent = 'Adding...';

      // Extract data based on page type
      let data;
      if (pageType === 'linkedin_profile') {
        data = extractLinkedInData();
        if (!data.fullName) {
          throw new Error('Could not extract profile name.');
        }
      } else if (pageType === 'signa') {
        data = extractSignaData();
        if (!data.fullName) {
          throw new Error('Could not extract person name from Signa.');
        }
      } else {
        data = extractWebsiteData();
        if (!data.companyName) {
          throw new Error('Could not extract company name.');
        }
      }

      // Add note and selected list to data
      data.note = noteInput.value;
      const selectedList = document.querySelector('.affinity-list-option.selected');
      data.targetList = selectedList ? selectedList.dataset.list : 'master_deal';

      // Send to background script
      const response = await chrome.runtime.sendMessage({
        action: 'addToAffinity',
        data: data
      });

      if (response.success) {
        hideModal();

        // Show success with link
        showSuccessToast(response.affinityUrl);

        // Update button temporarily
        if (button) {
          button.classList.add('success');
          const originalHTML = button.innerHTML;
          button.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>Added!</span>
          `;
          setTimeout(() => {
            button.classList.remove('success');
            button.innerHTML = originalHTML;
          }, 3000);
        }
      } else {
        throw new Error(response.error || 'Failed to add to Affinity');
      }
    } catch (error) {
      console.error('Affinity Stealth Adder Error:', error);
      alert('Error: ' + error.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Add to Affinity';
    }
  }

  // Show success toast with link (positioned above the button)
  function showSuccessToast(affinityUrl) {
    const toast = document.createElement('div');
    toast.id = 'affinity-success-toast';
    toast.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <span>Added to Affinity!</span>
      <a href="${affinityUrl}" target="_blank">Open →</a>
    `;
    document.body.appendChild(toast);

    // Position toast near the button
    const button = document.getElementById('affinity-stealth-btn');
    if (button) {
      const rect = button.getBoundingClientRect();
      toast.style.bottom = 'auto';
      toast.style.right = 'auto';
      toast.style.left = rect.left + 'px';
      toast.style.top = (rect.top - toast.offsetHeight - 10) + 'px';
    }

    // Animate in
    setTimeout(() => toast.classList.add('show'), 10);

    // Remove after 5 seconds
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  // Toggle button visibility (persists across all pages)
  async function toggleButtonVisibility() {
    const { affinityButtonHidden } = await chrome.storage.sync.get(['affinityButtonHidden']);
    const newState = !affinityButtonHidden;

    await chrome.storage.sync.set({ affinityButtonHidden: newState });

    const button = document.getElementById('affinity-stealth-btn');
    if (newState) {
      // Hide button
      if (button) button.remove();
    } else {
      // Show button
      if (!button) createFloatingButton();
    }
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Cmd+Shift+A or Ctrl+Shift+A - Open modal
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      const overlay = document.getElementById('affinity-modal-overlay');
      if (overlay && overlay.style.display === 'flex') {
        hideModal();
      } else {
        showNoteModal();
      }
    }
    // Cmd+Shift+H or Ctrl+Shift+H - Toggle button visibility
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'h') {
      e.preventDefault();
      toggleButtonVisibility();
    }
    // ESC to close modal
    if (e.key === 'Escape') {
      hideModal();
    }
    // Enter to submit when modal is open
    if (e.key === 'Enter' && !e.shiftKey) {
      const overlay = document.getElementById('affinity-modal-overlay');
      if (overlay && overlay.style.display === 'flex') {
        e.preventDefault();
        handleAddToAffinity();
      }
    }
  });

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createFloatingButton);
  } else {
    createFloatingButton();
  }

  // Re-check on navigation (for SPAs like LinkedIn)
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      const existingBtn = document.getElementById('affinity-stealth-btn');
      if (existingBtn) existingBtn.remove();
      const existingModal = document.getElementById('affinity-modal-overlay');
      if (existingModal) existingModal.remove();
      const existingToast = document.getElementById('affinity-success-toast');
      if (existingToast) existingToast.remove();
      createFloatingButton();
    }
  }).observe(document, { subtree: true, childList: true });
})();
