document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const listIdInput = document.getElementById('listId');
  const peopleListIdInput = document.getElementById('peopleListId');
  const tenantSubdomainInput = document.getElementById('tenantSubdomain');
  const userEmailInput = document.getElementById('userEmail');
  const saveButton = document.getElementById('save');
  const toggleButton = document.getElementById('toggleButton');
  const statusDiv = document.getElementById('status');

  // Load saved settings
  chrome.storage.sync.get(['affinityApiKey', 'affinityListId', 'affinityPeopleListId', 'affinityTenantSubdomain', 'affinityUserEmail'], (result) => {
    if (result.affinityApiKey) {
      apiKeyInput.value = result.affinityApiKey;
    }
    if (result.affinityListId) {
      listIdInput.value = result.affinityListId;
    }
    if (result.affinityPeopleListId) {
      peopleListIdInput.value = result.affinityPeopleListId;
    }
    if (result.affinityTenantSubdomain) {
      tenantSubdomainInput.value = result.affinityTenantSubdomain;
    }
    if (result.affinityUserEmail) {
      userEmailInput.value = result.affinityUserEmail;
    }
  });

  // Save settings
  saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const listId = listIdInput.value.trim();
    const peopleListId = peopleListIdInput.value.trim();
    const tenantSubdomain = tenantSubdomainInput.value.trim();
    const userEmail = userEmailInput.value.trim();

    if (!apiKey || !listId) {
      showStatus('Please fill in API key and List ID', 'error');
      return;
    }

    chrome.storage.sync.set({
      affinityApiKey: apiKey,
      affinityListId: listId,
      affinityPeopleListId: peopleListId,
      affinityTenantSubdomain: tenantSubdomain,
      affinityUserEmail: userEmail
    }, () => {
      showStatus('Settings saved successfully!', 'success');
    });
  });

  // Load toggle button state
  chrome.storage.sync.get(['affinityButtonHidden'], (result) => {
    toggleButton.textContent = result.affinityButtonHidden ? 'Show Floating Button' : 'Hide Floating Button';
  });

  // Toggle floating button visibility
  toggleButton.addEventListener('click', () => {
    chrome.storage.sync.get(['affinityButtonHidden'], (result) => {
      const newState = !result.affinityButtonHidden;
      chrome.storage.sync.set({ affinityButtonHidden: newState }, () => {
        toggleButton.textContent = newState ? 'Show Floating Button' : 'Hide Floating Button';
        showStatus(newState ? 'Floating button hidden' : 'Floating button visible', 'success');
      });
    });
  });

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = 'status ' + type;
    setTimeout(() => {
      statusDiv.className = 'status';
    }, 3000);
  }
});
