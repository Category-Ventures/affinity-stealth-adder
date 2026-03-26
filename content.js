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
          <div id="affinity-source-picker">
            <label for="affinity-source-select">Source <span style="color:#e53e3e">*</span></label>
            <select id="affinity-source-select">
              <option value="">Select source...</option>
              <option value="Inbound">Inbound</option>
              <option value="Outbound">Outbound</option>
              <option value="VC Intro">VC Intro</option>
              <option value="Operator Intro">Operator Intro</option>
              <option value="Accelerator">Accelerator</option>
              <option value="Conference">Conference</option>
            </select>
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

    // Show/hide source picker based on selected list
    function updateSourceVisibility() {
      const selectedList = overlay.querySelector('.affinity-list-option.selected');
      const sourcePicker = document.getElementById('affinity-source-picker');
      if (sourcePicker) {
        sourcePicker.style.display = (selectedList && selectedList.dataset.list === 'master_deal') ? 'block' : 'none';
      }
    }
    overlay.querySelectorAll('.affinity-list-option').forEach(btn => {
      btn.addEventListener('click', updateSourceVisibility);
    });
    updateSourceVisibility();

    document.getElementById('affinity-source-select').value = '';
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

  const US_STATES = new Set([
    'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
    'Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa',
    'Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan',
    'Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada',
    'New Hampshire','New Jersey','New Mexico','New York','North Carolina',
    'North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island',
    'South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont',
    'Virginia','Washington','West Virginia','Wisconsin','Wyoming',
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN',
    'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV',
    'NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN',
    'TX','UT','VT','VA','WA','WV','WI','WY','DC'
  ]);

  const KNOWN_COUNTRIES = new Set([
    'United States','USA','US','Canada','United Kingdom','UK','Australia',
    'Germany','France','India','China','Japan','Brazil','Mexico','Singapore',
    'Israel','Netherlands','Sweden','Norway','Denmark','Finland','Switzerland',
    'Spain','Italy','Portugal','Ireland','New Zealand','South Korea','Nigeria',
    'Kenya','Ghana','South Africa','UAE','United Arab Emirates','Pakistan',
    'Bangladesh','Indonesia','Malaysia','Philippines','Vietnam','Thailand',
    'Argentina','Colombia','Chile','Peru','Egypt','Morocco','Turkey','Poland',
    'Czech Republic','Austria','Belgium','Romania','Ukraine','Russia',
    'Hong Kong','Taiwan','Sri Lanka','Nepal','Ethiopia','Tanzania','Uganda',
    'Cameroon','Senegal','Ivory Coast','Zimbabwe','Zambia','Rwanda','Estonia',
    'Latvia','Lithuania','Slovakia','Slovenia','Croatia','Serbia','Bulgaria',
    'Hungary','Greece','Cyprus','Malta','Luxembourg','Iceland','Georgia',
    'Armenia','Azerbaijan','Kazakhstan','Uzbekistan','Myanmar','Cambodia',
    'Bolivia','Ecuador','Venezuela','Uruguay','Paraguay','Costa Rica',
    'Guatemala','Honduras','El Salvador','Nicaragua','Panama','Cuba',
    'Dominican Republic','Haiti','Jamaica','Trinidad and Tobago','Bahamas',
    'Barbados','Guyana','Suriname','New Caledonia','Fiji','Papua New Guinea',
  ]);

  // Parse a LinkedIn location string into structured {city, state, country}
  // Returns null if the text doesn't look like a real location
  function parseLinkedInLocation(text) {
    if (!text) return null;
    const loc = text.trim();

    // "Greater X Area" / "Greater X Metropolitan Area"
    const greaterMatch = loc.match(/^Greater (.+?)(?:\s+City)?\s+(?:Metropolitan\s+)?Area$/i);
    if (greaterMatch) {
      return { city: greaterMatch[1].trim(), state: null, country: 'United States' };
    }

    // "X Bay Area" / "X Metro Area" / "X Metropolitan Area"
    // Keep the full string as city (e.g. "San Francisco Bay Area") — more useful than stripping "Bay Area"
    if (/\b(?:Bay|Metro(?:politan)?)\s+Area$/i.test(loc)) {
      return { city: loc, state: null, country: 'United States' };
    }

    const parts = loc.split(',').map(p => p.trim()).filter(Boolean);

    // Single word/phrase — only valid if it's a known country
    if (parts.length === 1) {
      return KNOWN_COUNTRIES.has(parts[0]) ? { city: null, state: null, country: parts[0] } : null;
    }

    const last = parts[parts.length - 1];

    // Last part must be a known country, US state, or 2-letter state abbrev
    const isKnownPlace = KNOWN_COUNTRIES.has(last) || US_STATES.has(last) || /^[A-Z]{2}$/.test(last);
    if (!isKnownPlace) return null;

    if (parts.length === 2) {
      if (US_STATES.has(last)) return { city: parts[0], state: last, country: 'United States' };
      return { city: parts[0], state: null, country: last };
    }
    // 3+ parts: city, state/region, country
    return { city: parts[0], state: parts[1], country: parts[2] };
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

    // Try to extract location from LinkedIn profile
    let location = null;
    // Matches: "City, State", "City, Country", "Greater X Area", "X Bay Area", "X Metro Area"
    const locationPattern = /^(Greater .+? Area|.+\s+(?:Bay|Metro(?:politan)?)\s+Area|.+,\s*.+)$/i;

    function tryParseLocation(text, source) {
      if (!text || text.length > 100 || text.includes('@') || text.includes('http')) return false;
      if (/\b[A-Z]{2,}-[A-Z]{2,}\b/.test(text)) return false;  // credentials e.g. MS-HRM
      if (/\b(engineer|manager|director|founder|ceo|cto|vp|head|lead|senior|associate|analyst|connections?|followers?|recruiter|intern)\b/i.test(text)) return false;
      // Must match the location pattern
      if (!locationPattern.test(text)) return false;
      const parsed = parseLinkedInLocation(text);
      if (parsed && (parsed.city || parsed.country)) {
        location = parsed;
        console.log('Affinity: found location via', source + ':', text, '→', parsed);
        return true;
      }
      return false;
    }

    // Strategy 0a: class/attribute-based selectors — most reliable if LinkedIn's class names cooperate
    const locationSelectors = [
      '[class*="location"]',
      '[class*="geo"]',
      '[data-field="location"]',
      '.pv-top-card--list-bullet li',
    ];
    for (const selector of locationSelectors) {
      try {
        for (const el of document.querySelectorAll(selector)) {
          if (tryParseLocation(el.textContent.trim(), 'selector:' + selector)) break;
        }
      } catch(e) {}
      if (location) break;
    }

    // Strategy 0b: find name element, then look at nearby siblings/cousins for location
    if (!location && fullName) {
      const nameEls = Array.from(document.querySelectorAll('h1, [class*="name"]'))
        .filter(el => el.textContent.trim() === fullName);
      for (const nameEl of nameEls) {
        // Walk up to a top-card container, then scan all descendants
        const container = nameEl.closest('[class*="top-card"], [class*="profile-info"], [class*="pv-top"]')
          || nameEl.parentElement?.parentElement?.parentElement;
        if (!container) continue;
        for (const el of container.querySelectorAll('span, li')) {
          const text = el.textContent.trim();
          if (text === fullName) continue;
          if (tryParseLocation(text, 'near-name')) break;
        }
        if (location) break;
      }
    }

    // Strategy 0c: check embedded JSON (LinkedIn sometimes stores data in <code> blocks)
    if (!location) {
      for (const el of document.querySelectorAll('code, script[type="application/ld+json"], script[type="application/json"]')) {
        try {
          const json = JSON.parse(el.textContent);
          // JSON-LD Person schema
          const addr = json?.address || json?.data?.profile?.location;
          if (addr) {
            const loc = typeof addr === 'string' ? addr : (addr.addressLocality || addr.addressRegion || '');
            if (loc) tryParseLocation(loc, 'json-ld');
          }
          // LinkedIn voyager API style
          const geoName = json?.data?.geoLocationName || json?.geoLocationName;
          if (geoName && !location) tryParseLocation(geoName, 'json-geo');
        } catch(e) {}
        if (location) break;
      }
    }

    // Strategy 1: scan leaf text elements (textContent)
    if (!location) {
      for (const el of document.querySelectorAll('span, div, p, li')) {
        if (el.children.length > 2) continue;
        if (tryParseLocation(el.textContent.trim(), 'textContent')) break;
      }
    }

    // Strategy 2: scan aria-label attributes
    if (!location) {
      for (const el of document.querySelectorAll('[aria-label]')) {
        if (tryParseLocation((el.getAttribute('aria-label') || '').trim(), 'aria-label')) break;
      }
    }

    // Strategy 3: scan innerText of elements (catches CSS-joined text)
    if (!location) {
      for (const el of document.querySelectorAll('span, div, p')) {
        const lines = (el.innerText || '').trim().split('\n');
        for (const line of lines.slice(0, 3)) {  // check first 3 lines of each element
          if (tryParseLocation(line.trim(), 'innerText')) break;
        }
        if (location) break;
      }
    }

    if (!location) {
      // Debug: elements that have "location" or "geo" in their class name
      const locClassEls = Array.from(document.querySelectorAll('[class]'))
        .filter(el => el.className && typeof el.className === 'string' && /location|geo/i.test(el.className))
        .slice(0, 10)
        .map(el => `${el.tagName}.${el.className.trim().split(/\s+/)[0]}: "${el.textContent.trim().slice(0, 80)}"`);
      console.log('Affinity: location/geo class elements:', locClassEls);

      // Debug: all text nodes sorted by page position, dedup keeping FIRST (topmost) per text
      const allNodes = [];
      for (const el of document.querySelectorAll('*')) {
        for (const n of el.childNodes) {
          if (n.nodeType === 3) {
            const t = n.textContent.trim();
            if (t && t.length > 2 && t.length < 100) {
              const rect = el.getBoundingClientRect();
              const top = rect.top + window.scrollY;
              allNodes.push({ t, top, visible: rect.width > 0 && rect.height > 0 });
            }
          }
        }
      }
      allNodes.sort((a, b) => a.top - b.top);
      // Keep first (topmost) occurrence of each text; separate visible vs hidden
      const seen = new Set();
      const unique = allNodes.filter(n => { if (seen.has(n.t)) return false; seen.add(n.t); return true; });
      const visible = unique.filter(n => n.visible).slice(0, 30);
      const hidden = unique.filter(n => !n.visible).slice(0, 10);
      console.log('Affinity: top 30 VISIBLE text nodes:', visible.map(n => n.top.toFixed(0) + 'px: ' + n.t));
      console.log('Affinity: sample HIDDEN text nodes (display:none):', hidden.map(n => n.t));

      // Debug: innerText of top 5 non-nav visible spans as a cross-check
      const topSpans = Array.from(document.querySelectorAll('span'))
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top > 50 && r.top < 500; })
        .slice(0, 20)
        .map(el => `${el.getBoundingClientRect().top.toFixed(0)}px: "${(el.innerText || '').trim().slice(0, 80)}"`);
      console.log('Affinity: visible spans in top 500px of viewport:', topSpans);
    }

    return {
      type: 'linkedin_profile',
      fullName,
      linkedinUrl,
      location,
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

      // Add note, list, and source to data
      data.note = noteInput.value;
      const selectedList = document.querySelector('.affinity-list-option.selected');
      data.targetList = selectedList ? selectedList.dataset.list : 'master_deal';

      // Require source for MDL additions
      if (data.targetList === 'master_deal') {
        const sourceSelect = document.getElementById('affinity-source-select');
        if (!sourceSelect || !sourceSelect.value) {
          throw new Error('Please select a source before adding to the Master Deal List.');
        }
        data.source = sourceSelect.value;
      }

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
