// State Management
let currentUser = null;
let activeTab = 'publicScan';
let activeAnalysisResult = null;

// On Page Load
document.addEventListener('DOMContentLoaded', () => {
    checkSavedSession();
    updateTabVisibility();
    // Set default date picker to 1 year from today
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    const datePicker = document.getElementById('vetDueDate');
    if (datePicker) datePicker.value = nextYear.toISOString().split('T')[0];

    // Attempt early geolocation preview if permission was previously granted
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(async () => {
            const loc = await fetchUserLocation();
            const locationBadge = document.getElementById('scanLocationText');
            if (locationBadge) locationBadge.innerText = loc;
        }, () => {}, { timeout: 3000, maximumAge: 60000 });
    }
});

// ----------------------------------------------------
// 1. NAVIGATION & TAB SWITCHING
// ----------------------------------------------------
function switchTab(tabName) {
    activeTab = tabName;
    updateTabVisibility();
}

function updateTabVisibility() {
    // Hide all tab sections
    document.getElementById('tabPublicScan').classList.add('hidden');
    document.getElementById('tabOwnerDashboard').classList.add('hidden');
    document.getElementById('tabRescuerDashboard').classList.add('hidden');
    document.getElementById('tabVetDashboard').classList.add('hidden');

    // Reset tab button styles
    ['navPublic', 'navOwner', 'navRescuer', 'navVet'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.className = "px-4 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-2 text-slate-400 hover:text-white hover:bg-slate-800/50";
    });

    // Show active tab
    if (activeTab === 'publicScan') {
        document.getElementById('tabPublicScan').classList.remove('hidden');
        document.getElementById('navPublic').className = "px-4 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-2 bg-amber-500 text-slate-950 shadow";
    } else if (activeTab === 'ownerDashboard') {
        document.getElementById('tabOwnerDashboard').classList.remove('hidden');
        document.getElementById('navOwner').className = "px-4 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-2 bg-amber-500 text-slate-950 shadow";
        loadOwnerData();
    } else if (activeTab === 'rescuerDashboard') {
        document.getElementById('tabRescuerDashboard').classList.remove('hidden');
        document.getElementById('navRescuer').className = "px-4 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-2 bg-amber-500 text-slate-950 shadow";
        loadRescuerDispatches();
    } else if (activeTab === 'vetDashboard') {
        document.getElementById('tabVetDashboard').classList.remove('hidden');
        document.getElementById('navVet').className = "px-4 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-2 bg-amber-500 text-slate-950 shadow";
        loadVetData();
    }
}


// ----------------------------------------------------
// 2. AUTHENTICATION & RBAC LOGIN HANDLERS
// ----------------------------------------------------
function openLoginModal() {
    document.getElementById('loginModal').classList.remove('hidden');
    switchAuthMode('login');
}

function closeLoginModal() {
    document.getElementById('loginModal').classList.add('hidden');
}

function switchAuthMode(mode) {
    const signInBtn = document.getElementById('authTabSignIn');
    const registerBtn = document.getElementById('authTabRegister');
    const loginContainer = document.getElementById('loginFormContainer');
    const registerContainer = document.getElementById('registerFormContainer');

    if (!signInBtn || !registerBtn || !loginContainer || !registerContainer) return;

    if (mode === 'login') {
        signInBtn.className = "w-1/2 py-2 rounded-xl text-amber-400 bg-slate-900 border border-slate-800 shadow transition";
        registerBtn.className = "w-1/2 py-2 rounded-xl text-slate-400 hover:text-white transition";
        loginContainer.classList.remove('hidden');
        registerContainer.classList.add('hidden');
    } else {
        registerBtn.className = "w-1/2 py-2 rounded-xl text-amber-400 bg-slate-900 border border-slate-800 shadow transition";
        signInBtn.className = "w-1/2 py-2 rounded-xl text-slate-400 hover:text-white transition";
        registerContainer.classList.remove('hidden');
        loginContainer.classList.add('hidden');
    }
}

function previewRegThumbnail(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const previewContainer = document.getElementById('regImagePreviewContainer');
            if (previewContainer) previewContainer.classList.remove('hidden');
            const preview = document.getElementById('regImagePreview');
            if (preview) preview.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
}

function fillDemoLogin(username, password) {
    document.getElementById('loginUsername').value = username;
    document.getElementById('loginPassword').value = password;
}

async function handleLoginSubmit(event) {
    event.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();
        if (data.success) {
            currentUser = data;
            localStorage.setItem('pawid_user', JSON.stringify(currentUser));
            applyUserSession();
            closeLoginModal();

            // Redirect to role dashboard
            if (data.role === 'OWNER') switchTab('ownerDashboard');
            else if (data.role === 'RESCUER') switchTab('rescuerDashboard');
            else if (data.role === 'VET') switchTab('vetDashboard');
        } else {
            alert('Login Failed: ' + data.error);
        }
    } catch (err) {
        console.error(err);
        alert('Connection error during login.');
    }
}

async function handleRegistrationSubmit(event) {
    event.preventDefault();
    const username = document.getElementById('regUsername').value;
    const password = document.getElementById('regPassword').value;
    const ownerName = document.getElementById('regOwnerName').value;
    const ownerPhone = document.getElementById('regOwnerPhone').value;
    const petName = document.getElementById('regPetName').value;
    const fileInput = document.getElementById('regPetImage');
    const submitBtn = document.getElementById('regSubmitBtn');

    if (!fileInput.files || fileInput.files.length === 0) {
        alert('Please select a photo of your pet to generate a biometric PawID.');
        return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onloadend = async function () {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin mr-2"></i> Analyzing Biometrics & Issuing PawID...`;

        try {
            const response = await fetch('/api/register-owner', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username,
                    password,
                    ownerName,
                    ownerPhone,
                    petName,
                    imageBase64: reader.result
                })
            });

            const data = await response.json();
            if (data.success) {
                alert(data.message || `Registration Successful! Issued PawID: #${data.dogId}`);
                
                // Auto login user
                currentUser = {
                    success: true,
                    role: "OWNER",
                    user: data.user
                };
                localStorage.setItem('pawid_user', JSON.stringify(currentUser));
                applyUserSession();
                closeLoginModal();

                // Redirect to owner dashboard
                switchTab('ownerDashboard');
            } else {
                alert('Registration Error: ' + data.error);
            }
        } catch (err) {
            console.error(err);
            alert('Failed to connect to registration server.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i class="fa-solid fa-id-card mr-1.5"></i> REGISTER & GENERATE PAWID`;
        }
    };

    reader.readAsDataURL(file);
}

function checkSavedSession() {
    const saved = localStorage.getItem('pawid_user');
    if (saved) {
        try {
            currentUser = JSON.parse(saved);
            applyUserSession();
        } catch (e) { localStorage.removeItem('pawid_user'); }
    }
}

function applyUserSession() {
    if (!currentUser) return;
    document.getElementById('authLoggedOut').classList.add('hidden');
    document.getElementById('authLoggedIn').classList.remove('hidden');

    const badge = document.getElementById('userRoleBadge');
    badge.innerText = currentUser.role;
    if (currentUser.role === 'OWNER') badge.className = "font-extrabold uppercase px-2 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30";
    else if (currentUser.role === 'RESCUER') badge.className = "font-extrabold uppercase px-2 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 border border-red-500/30";
    else if (currentUser.role === 'VET') badge.className = "font-extrabold uppercase px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";

    document.getElementById('userDisplayName').innerText = currentUser.user.name;
}

function logoutUser() {
    currentUser = null;
    localStorage.removeItem('pawid_user');
    document.getElementById('authLoggedOut').classList.remove('hidden');
    document.getElementById('authLoggedIn').classList.add('hidden');
    switchTab('publicScan');
}


// ----------------------------------------------------
// 3. PUBLIC SCAN & REAL-TIME GEOLOCATION & AI TRIAGE
// ----------------------------------------------------

/**
 * Fetches the user's real-time device location using navigator.geolocation.
 * Performs reverse geocoding if available/granted, with fallback to default city.
 * @returns {Promise<string>} Location description or fallback city
 */
async function fetchUserLocation() {
    const DEFAULT_LOCATION = "Mumbai, Maharashtra";

    if (!("geolocation" in navigator)) {
        console.warn("Geolocation is not supported by this browser. Using default fallback location.");
        return DEFAULT_LOCATION;
    }

    return new Promise((resolve) => {
        const options = {
            enableHighAccuracy: true,
            timeout: 6000,
            maximumAge: 0
        };

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;

                // Attempt reverse geocoding lookup via OpenStreetMap Nominatim
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 3500);

                    const response = await fetch(
                        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
                        {
                            headers: { 'User-Agent': 'PawID-Care/1.0' },
                            signal: controller.signal
                        }
                    );
                    clearTimeout(timeoutId);

                    if (response.ok) {
                        const data = await response.json();
                        const addr = data.address || {};
                        const placeName = addr.suburb || addr.neighbourhood || addr.road || addr.quarter || addr.residential;
                        const cityName = addr.city || addr.town || addr.village || addr.county || addr.suburb;
                        const stateName = addr.state;

                        const parts = [placeName, cityName, stateName].filter(Boolean);
                        if (parts.length > 0) {
                            return resolve(`${parts.join(', ')} (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
                        } else if (data.display_name) {
                            return resolve(`${data.display_name} (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
                        }
                    }
                } catch (err) {
                    console.warn("Reverse geocoding lookup skipped/failed:", err.message);
                }

                // Fallback if reverse geocoding request fails: return exact coordinates
                resolve(`Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`);
            },
            (error) => {
                console.warn("Geolocation permission denied or error:", error.message);
                resolve(DEFAULT_LOCATION);
            },
            options
        );
    });
}

function previewThumbnail(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            document.getElementById('uploadPrompt').classList.add('hidden');
            const previewContainer = document.getElementById('imagePreviewContainer');
            previewContainer.classList.remove('hidden');
            document.getElementById('imagePreview').src = e.target.result;
        }
        reader.readAsDataURL(file);
    }
}

async function submitReport() {
    const fileInput = document.getElementById('dogImage');
    const btn = document.getElementById('submitBtn');
    const emptyState = document.getElementById('emptyState');
    const resultsDiv = document.getElementById('results');

    if (fileInput.files.length === 0) {
        alert('Please upload or capture a dog photo first.');
        return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onloadend = async function () {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin mr-2"></i> Capturing Device Location...`;

        // Fetch real-time device location via browser Geolocation API
        const locationString = await fetchUserLocation();

        // Update Scan Location UI element
        const locationBadge = document.getElementById('scanLocationText');
        if (locationBadge) {
            locationBadge.innerText = locationString;
        }

        btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin mr-2"></i> Analyzing Biometrics & Triage...`;

        try {
            const response = await fetch('/api/report-dog', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    imageBase64: reader.result,
                    userRole: currentUser ? currentUser.role : 'PUBLIC',
                    location: locationString
                })
            });

            const data = await response.json();
            if (data.success) {
                activeAnalysisResult = data;
                emptyState.classList.add('hidden');
                resultsDiv.classList.remove('hidden');

                // Bind Data
                document.getElementById('resDogId').innerText = `#${data.profile.dogId}`;
                document.getElementById('resDogName').innerText = data.profile.name || "Community Stray";
                document.getElementById('resDogTypeBadge').innerText = data.profile.type;
                document.getElementById('resCaseTag').innerText = data.routingDecision.caseType || "Case Analysis";
                document.getElementById('resVaccination').innerText = data.profile.vaccinationStatus;
                document.getElementById('resInjury').innerText = data.analysis.injuryDetected || "None";
                document.getElementById('resSignature').innerText = data.profile.visualSignature || data.analysis.visualAnalysis?.breedOrCoat;
                document.getElementById('resRoutingAlert').innerText = data.routingDecision.alertMessage;
                document.getElementById('resRecommendedAction').innerText = `Action Advice: ${data.analysis.recommendedAction}`;
                document.getElementById('resSolanaTx').innerText = data.solanaTx;
                document.getElementById('resHerdImmunity').innerText = data.herdImmunityScore;

                // Urgency Styling
                const urgencyBadge = document.getElementById('resUrgencyBadge');
                const urgency = data.analysis.urgencyLevel;
                urgencyBadge.innerText = `${urgency} URGENCY`;

                if (urgency === 'HIGH') {
                    urgencyBadge.className = "px-4 py-2 rounded-2xl text-xs font-black uppercase tracking-wider bg-red-500/20 text-red-400 border border-red-500/40";
                } else if (urgency === 'MEDIUM') {
                    urgencyBadge.className = "px-4 py-2 rounded-2xl text-xs font-black uppercase tracking-wider bg-amber-500/20 text-amber-400 border border-amber-500/40";
                } else {
                    urgencyBadge.className = "px-4 py-2 rounded-2xl text-xs font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/40";
                }

                // Auto open call simulator if emergency call was triggered
                if (data.routingDecision.callTriggered) {
                    setTimeout(() => {
                        launchInteractiveCallModal();
                    }, 600);
                }

            } else {
                alert(data.error || 'Error processing scan.');
            }
        } catch (err) {
            console.error(err);
            alert('Failed to communicate with PawID backend server.');
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles mr-2"></i> RUN BIOMETRIC & EMERGENCY TRIAGE`;
        }
    };

    reader.readAsDataURL(file);
}

// Voice Call Simulation Modal Handlers
function launchInteractiveCallModal() {
    if (!activeAnalysisResult || !activeAnalysisResult.routingDecision) return;
    const routing = activeAnalysisResult.routingDecision;

    document.getElementById('callTargetName').innerText = `Target: ${routing.targetName} (${routing.targetEntity})`;
    document.getElementById('callTargetPhone').innerText = routing.targetPhone;
    document.getElementById('callTranscriptText').innerText = routing.callScript;

    // Show cascade button if owner call
    const actionContainer = document.getElementById('callActionContainer');
    if (routing.targetEntity === 'OWNER') {
        actionContainer.classList.remove('hidden');
    } else {
        actionContainer.classList.remove('hidden');
    }

    document.getElementById('callModal').classList.remove('hidden');

    // Web Speech API Voice synthesis for realism
    if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(routing.callScript);
        utterance.rate = 1.0;
        window.speechSynthesis.speak(utterance);
    }
}

async function confirmRescueCascade(confirmRescue) {
    if (!activeAnalysisResult || !activeAnalysisResult.routingDecision.dispatchLogId) {
        document.getElementById('callModal').classList.add('hidden');
        return;
    }

    try {
        const response = await fetch('/api/confirm-rescue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dispatchId: activeAnalysisResult.routingDecision.dispatchLogId,
                confirmRescue
            })
        });

        const data = await response.json();
        alert(data.message);
    } catch (e) {
        console.error(e);
    } finally {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        document.getElementById('callModal').classList.add('hidden');
    }
}


// ----------------------------------------------------
// 4. OWNER DASHBOARD HANDLERS
// ----------------------------------------------------
async function loadOwnerData() {
    const isOwner = currentUser && currentUser.role === 'OWNER';
    const lockNotice = document.getElementById('ownerAuthLockNotice');
    const content = document.getElementById('ownerContentContainer');

    if (!isOwner) {
        if (lockNotice) lockNotice.classList.remove('hidden');
        if (content) content.classList.add('hidden');
        return;
    }

    if (lockNotice) lockNotice.classList.add('hidden');
    if (content) content.classList.remove('hidden');

    try {
        const res = await fetch(`/api/owner/pets/${currentUser.user.username}`);
        const data = await res.json();
        if (data.success) {
            document.getElementById('ownerPetName').innerText = data.pet.name;
            document.getElementById('ownerPetId').innerText = `#${data.pet.dogId}`;
            document.getElementById('ownerPetVaccine').innerText = data.pet.vaccinationStatus;
            document.getElementById('ownerPetHealth').innerText = data.pet.healthStatus;
            document.getElementById('ownerPetMedical').innerText = data.pet.medicalHistory || "None recorded";
            document.getElementById('ownerPhoneInput').value = data.pet.ownerPhone || "";

            const visualSigEl = document.getElementById('ownerPetVisualSig');
            if (visualSigEl) {
                visualSigEl.innerText = data.pet.visualSignature || "Scanned coat and breed biometrics recorded";
            }

            const photoContainer = document.getElementById('ownerPetPhotoContainer');
            const photoEl = document.getElementById('ownerPetPhoto');
            if (data.pet.photoBase64 && photoContainer && photoEl) {
                photoEl.src = data.pet.photoBase64;
                photoContainer.classList.remove('hidden');
            } else if (photoContainer) {
                photoContainer.classList.add('hidden');
            }

            const alertList = document.getElementById('ownerAlertsList');
            document.getElementById('ownerAlertCount').innerText = `${data.alerts.length} Alerts`;
            if (data.alerts.length === 0) {
                alertList.innerHTML = `<div class="text-center py-8 text-slate-500 text-xs">No emergency triage alerts recorded for your pet.</div>`;
            } else {
                alertList.innerHTML = data.alerts.map(a => `
                    <div class="bg-slate-950/60 p-4 rounded-2xl border border-slate-800 text-xs space-y-1.5">
                        <div class="flex items-center justify-between">
                            <span class="font-bold text-red-400 flex items-center"><i class="fa-solid fa-triangle-exclamation mr-1.5"></i> ${a.urgency} URGENCY ALERT</span>
                            <span class="text-[10px] text-slate-500">${new Date(a.timestamp).toLocaleString()}</span>
                        </div>
                        <p class="text-slate-200 font-medium">${a.injuryDetails}</p>
                        <p class="text-[11px] text-slate-400">${a.notes}</p>
                    </div>
                `).join('');
            }
        }
    } catch (e) { console.error(e); }
}

async function updateOwnerProfile() {
    if (!currentUser || currentUser.role !== 'OWNER') {
        alert("Access denied. You must be logged in as an authorized Pet Owner.");
        return;
    }
    const newPhone = document.getElementById('ownerPhoneInput').value;
    try {
        const res = await fetch('/api/owner/profile', {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentUser.role}`,
                'X-User-Role': currentUser.role,
                'X-User-Username': currentUser.user.username 
            },
            body: JSON.stringify({ 
                username: currentUser.user.username, 
                dogId: currentUser.user.dogId,
                ownerPhone: newPhone,
                userRole: currentUser.role,
                role: currentUser.role
            })
        });
        const data = await res.json();
        if (data.success) {
            alert('Emergency phone number saved!');
            loadOwnerData();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (e) { alert('Failed to update contact info.'); }
}


// ----------------------------------------------------
// 5. RESCUER DASHBOARD HANDLERS
// ----------------------------------------------------
let allDispatches = [];
async function loadRescuerDispatches() {
    try {
        const res = await fetch('/api/rescuer/dispatches');
        const data = await res.json();
        if (data.success) {
            allDispatches = data.dispatches;
            renderRescuerDispatches(allDispatches);
        }
    } catch (e) { console.error(e); }
}

function filterRescuerDispatches() {
    const val = document.getElementById('rescuerStatusFilter').value;
    if (val === 'ALL') renderRescuerDispatches(allDispatches);
    else renderRescuerDispatches(allDispatches.filter(d => d.status === val));
}

function renderRescuerDispatches(dispatches) {
    const container = document.getElementById('rescuerDispatchList');
    if (dispatches.length === 0) {
        container.innerHTML = `<div class="col-span-2 text-center py-10 text-slate-500 text-xs">No active emergency dispatches found.</div>`;
        return;
    }

    const isAuthorizedRescuer = currentUser && currentUser.role === 'RESCUER';

    container.innerHTML = dispatches.map(d => `
        <div class="bg-slate-950/60 p-5 rounded-2xl border border-slate-800 space-y-3 flex flex-col justify-between">
            <div class="space-y-2">
                <div class="flex items-center justify-between">
                    <span class="text-xs font-mono font-bold text-amber-400">#${d.dispatchId}</span>
                    <span class="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full ${d.status === 'RESOLVED' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}">
                        ${d.status}
                    </span>
                </div>
                <h4 class="text-sm font-extrabold text-white">${d.dogName} (${d.dogId})</h4>
                <div class="text-xs text-slate-300 bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-1">
                    <p><strong class="text-amber-400">Location:</strong> ${d.scannedLocation || 'Scanned Location'}</p>
                    <p><strong class="text-slate-400">Injury:</strong> ${d.injuryDetails || 'Trauma Reported'}</p>
                    <p class="text-[11px] text-slate-400"><strong class="text-slate-400">Target Contact:</strong> ${d.targetName} (${d.targetPhone})</p>
                </div>
            </div>

            <div class="pt-2 border-t border-slate-800 space-y-2">
                ${isAuthorizedRescuer ? (d.status !== 'RESOLVED' ? `
                    <div class="grid grid-cols-2 gap-2 text-xs font-bold">
                        <button onclick="updateDispatchStatus('${d.dispatchId}', 'EN_ROUTE')" class="bg-amber-500 hover:bg-amber-400 text-slate-950 py-2 rounded-xl transition">
                            En-Route
                        </button>
                        <button onclick="updateDispatchStatus('${d.dispatchId}', 'RESOLVED')" class="bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-xl transition">
                            Mark Rescued
                        </button>
                    </div>
                ` : `
                    <p class="text-[11px] text-emerald-400 font-bold flex items-center justify-center">
                        <i class="fa-solid fa-circle-check mr-1.5"></i> Rescue Intervention Completed
                    </p>
                `) : `
                    <div class="bg-slate-900/50 p-2.5 rounded-xl border border-slate-800 text-center">
                        <p class="text-[11px] text-slate-400 font-medium">
                            <i class="fa-solid fa-lock text-amber-400 mr-1"></i> Rescuer authentication required to update status
                        </p>
                    </div>
                `}
            </div>
        </div>
    `).join('');
}

async function updateDispatchStatus(dispatchId, status) {
    if (!currentUser || currentUser.role !== 'RESCUER') {
        alert("Access denied. You must be logged in as an authorized Rescuer to update dispatch logs.");
        return;
    }
    const notes = prompt("Enter optional rescue update note:", status === 'EN_ROUTE' ? 'Ambulance team dispatched' : 'Dog secured and stabilized');
    if (notes === null) return;

    try {
        const res = await fetch(`/api/rescuer/dispatch/${dispatchId}`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentUser.role}`,
                'X-User-Role': currentUser.role
            },
            body: JSON.stringify({ 
                status, 
                notes,
                userRole: currentUser.role,
                role: currentUser.role,
                username: currentUser.user ? currentUser.user.username : undefined
            })
        });
        const data = await res.json();
        if (data.success) {
            loadRescuerDispatches();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (e) { alert('Failed to update dispatch status.'); }
}


// ----------------------------------------------------
// 6. VET DASHBOARD HANDLERS
// ----------------------------------------------------
async function loadVetData() {
    const isVet = currentUser && currentUser.role === 'VET';
    const formContainer = document.getElementById('vetVaccineFormContainer');
    const lockNotice = document.getElementById('vetAuthLockNotice');

    if (isVet) {
        if (formContainer) formContainer.classList.remove('hidden');
        if (lockNotice) lockNotice.classList.add('hidden');
    } else {
        if (formContainer) formContainer.classList.add('hidden');
        if (lockNotice) lockNotice.classList.remove('hidden');
    }

    try {
        const res = await fetch('/api/vet/unimmunized-strays');
        const data = await res.json();
        if (data.success) {
            document.getElementById('vetHerdImmunityHeader').innerText = `Herd Immunity: ${data.herdImmunityScore}`;
            document.getElementById('unimmunizedCount').innerText = `${data.strays.length} Strays Needing Shots`;

            const strayList = document.getElementById('vetStrayList');
            if (data.strays.length === 0) {
                strayList.innerHTML = `<div class="text-center py-8 text-slate-500 text-xs">All registered area dogs are fully vaccinated!</div>`;
            } else {
                strayList.innerHTML = data.strays.map(s => `
                    <div class="bg-slate-950/60 p-4 rounded-2xl border border-slate-800 flex items-center justify-between text-xs">
                        <div class="space-y-0.5">
                            <h4 class="font-extrabold text-white">#${s.dogId} — ${s.name}</h4>
                            <p class="text-slate-400 text-[11px]">${s.visualSignature || s.type}</p>
                            <span class="text-[10px] font-bold text-red-400">${s.vaccinationStatus}</span>
                        </div>
                        ${isVet ? `
                            <button onclick="quickVaccinateSelect('${s.dogId}')" class="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 px-3 py-1.5 rounded-xl font-bold transition">
                                Administer Shot
                            </button>
                        ` : `
                            <button onclick="quickVaccinateSelect('${s.dogId}')" class="bg-slate-900 text-slate-500 border border-slate-800 px-3 py-1.5 rounded-xl text-[11px] font-semibold cursor-not-allowed">
                                Vet Auth Required
                            </button>
                        `}
                    </div>
                `).join('');
            }
        }
    } catch (e) { console.error(e); }
}

function quickVaccinateSelect(dogId) {
    if (!currentUser || currentUser.role !== 'VET') {
        alert("Access denied. Please log in as an authorized Vet Clinic to record vaccinations.");
        openLoginModal();
        return;
    }
    const input = document.getElementById('vetDogId');
    if (input) {
        input.value = dogId;
        input.focus();
    }
}

async function submitVetVaccination(event) {
    event.preventDefault();
    if (!currentUser || currentUser.role !== 'VET') {
        alert("Access denied. You must be logged in as an authorized Vet Clinic to record vaccinations.");
        return;
    }
    const dogId = document.getElementById('vetDogId').value;
    const vaccineType = document.getElementById('vetVaccineType').value;
    const batchNumber = document.getElementById('vetBatchNo').value;
    const nextDueDate = document.getElementById('vetDueDate').value;

    try {
        const res = await fetch('/api/vet/vaccinate', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentUser.role}`,
                'X-User-Role': currentUser.role,
                'X-User-Username': currentUser.user ? currentUser.user.username : ''
            },
            body: JSON.stringify({
                dogId,
                vaccineType,
                batchNumber,
                nextDueDate,
                userRole: currentUser.role,
                role: currentUser.role,
                username: currentUser.user ? currentUser.user.username : '',
                vetId: currentUser.user ? currentUser.user.id : "VET-001",
                vetName: currentUser.user ? currentUser.user.name : "Green Park Animal Clinic"
            })
        });

        const data = await res.json();
        if (data.success) {
            alert(data.message);
            document.getElementById('vetDogId').value = '';
            loadVetData();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (e) { alert('Failed to record vaccination.'); }
}
