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
    return 'website';
  }

  // Create floating button
  function createFloatingButton() {
    // Don't show on Affinity itself or extension pages
    if (window.location.hostname.includes('affinity.co') ||
        window.location.protocol === 'chrome-extension:') {
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
      button.title = 'Add as Stealth founder to Affinity';
    } else {
      button.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        <span>Add to Affinity</span>
      `;
      button.title = 'Add this company to Affinity';
    }

    document.body.appendChild(button);
    button.addEventListener('click', handleAddToAffinity);
    return button;
  }

  // Extract profile data from LinkedIn page
  function extractLinkedInData() {
    const nameElement = document.querySelector('h1.text-heading-xlarge') ||
                        document.querySelector('h1[class*="text-heading"]') ||
                        document.querySelector('.pv-top-card h1') ||
                        document.querySelector('h1');

    const fullName = nameElement ? nameElement.textContent.trim() : null;
    const linkedinUrl = window.location.href.split('?')[0];

    return {
      type: 'linkedin_profile',
      fullName,
      linkedinUrl
    };
  }

  // Extract company data from a regular website
  function extractWebsiteData() {
    const hostname = window.location.hostname.replace('www.', '');
    const domain = hostname;

    // Try to get company name from various sources
    let companyName = null;

    // 1. Try Open Graph meta tag
    const ogTitle = document.querySelector('meta[property="og:site_name"]');
    if (ogTitle && ogTitle.content) {
      companyName = ogTitle.content.trim();
    }

    // 2. Try page title (clean it up)
    if (!companyName) {
      const title = document.title;
      // Take first part before common separators
      companyName = title.split(/[\|\-–—:]/)[0].trim();
      // If it's too long or looks like a page title, use domain
      if (companyName.length > 50 || companyName.split(' ').length > 5) {
        companyName = null;
      }
    }

    // 3. Fall back to domain name (capitalize it)
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

  // Handle button click
  async function handleAddToAffinity() {
    const button = document.getElementById('affinity-stealth-btn');
    const originalContent = button.innerHTML;
    const pageType = getPageType();

    try {
      // Show loading state
      button.classList.add('loading');
      button.innerHTML = `
        <svg class="spinner" width="20" height="20" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="60" stroke-dashoffset="20"/>
        </svg>
        <span>Adding...</span>
      `;

      // Extract data based on page type
      let data;
      if (pageType === 'linkedin_profile') {
        data = extractLinkedInData();
        if (!data.fullName) {
          throw new Error('Could not extract profile name. Make sure you are on a LinkedIn profile page.');
        }
      } else {
        data = extractWebsiteData();
        if (!data.companyName) {
          throw new Error('Could not extract company name from this page.');
        }
      }

      // Send to background script
      const response = await chrome.runtime.sendMessage({
        action: 'addToAffinity',
        data: data
      });

      if (response.success) {
        button.classList.remove('loading');
        button.classList.add('success');
        button.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span>Added!</span>
        `;

        // Reset after 3 seconds
        setTimeout(() => {
          button.classList.remove('success');
          button.innerHTML = originalContent;
        }, 3000);
      } else {
        throw new Error(response.error || 'Failed to add to Affinity');
      }
    } catch (error) {
      button.classList.remove('loading');
      button.classList.add('error');
      button.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        <span>Error</span>
      `;

      console.error('Affinity Stealth Adder Error:', error);
      alert('Error: ' + error.message);

      // Reset after 3 seconds
      setTimeout(() => {
        button.classList.remove('error');
        button.innerHTML = originalContent;
      }, 3000);
    }
  }

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
      createFloatingButton();
    }
  }).observe(document, { subtree: true, childList: true });
})();
