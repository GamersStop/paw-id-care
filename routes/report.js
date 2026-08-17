const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { GoogleGenAI } = require('@google/genai');
const solanaWeb3 = require('@solana/web3.js');
const { readJson, writeJson, calculateHerdImmunityScore, executeSnowflakeQuery } = require('../utils/storage');
const { makeOutboundCall } = require('../utils/callService');


// Initialize Google Gen AI
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });

const DEFAULT_PHONE = process.env.DEFAULT_FALLBACK_PHONE;
const DEFAULT_RESCUER_PHONE = process.env.DEFAULT_RESCUER_PHONE;
const DEFAULT_VET_PHONE = process.env.DEFAULT_VET_PHONE;

// AI MULTIMODAL REPORT & EMERGENCY ROUTING DECISION ENGINE (POST /api/report-dog)
router.post('/report-dog', async (req, res) => {
    try {
        const { imageBase64, userRole, location } = req.body;
        const scannedLocation = (location && typeof location === 'string' && location.trim()) ? location.trim() : "Mumbai, Maharashtra";

        if (!imageBase64) {
            return res.status(400).json({ success: false, error: "No image provided." });
        }

        let dogRegistry = readJson('dog_registry.json');
        let rescuers = readJson('rescuers.json');
        let vets = readJson('vets.json');
        let dispatchLogs = readJson('dispatch_logs.json');

        const base64Data = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");

        // 1. GOOGLE AI VISION ANALYSIS
        const prompt = `
        You are an expert AI veterinary biometrics and emergency triage engine for "PawID & Care".
        FIRST, evaluate the image carefully: Is this image unmistakably a dog (canine)? Set "isDog" to true if the image clearly contains a dog, or false if it is any other animal, object, person, vehicle, building, or non-canine content.

        Analyze this image against our current ID registry:
        ${JSON.stringify(dogRegistry, null, 2)}

        Return ONLY a valid JSON object matching this structure (no markdown formatting, no extra commentary):
        {
          "isDog": boolean (true if the image is unmistakably a dog, false otherwise),
          "matchedDogId": "String (Match exact dogId from registry if visual match is found, e.g. PET-042 or MUM-183. If completely unknown, generate a unique ID like STRAY-${Math.floor(1000 + Math.random() * 9000)})",
          "isNewDog": boolean,
          "detectedType": "STRAY" or "PET",
          "visualAnalysis": {
            "breedOrCoat": "Description of coat color, breed traits, and visual markings",
            "distinctiveMarks": "Ear notches, collar, scars, or distinct patches"
          },
          "urgencyLevel": "LOW", "MEDIUM", or "HIGH",
          "injuryDetected": "Detailed description of wound/trauma, or 'None'",
          "isInjured": boolean,
          "recommendedAction": "Actionable emergency or preventative advice"
        }
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3.7-flash',
            contents: [
                { inlineData: { mimeType: 'image/jpeg', data: base64Data } },
                prompt
            ]
        });

        let aiResultText = response.text.trim();
        aiResultText = aiResultText.replace(/^```json\s*/, "").replace(/^```\s*/, "").replace(/\s*```$/, "");
        const analysis = JSON.parse(aiResultText);

        // Immediate Rejection Guardrail for Non-Dog Images
        if (analysis.isDog === false || analysis.isDog === "false") {
            return res.status(400).json({
                success: false,
                error: "Invalid upload: This image does not appear to be a dog. Please upload a clear photo of a dog to use PawID & Care."
            });
        }

        let profile = dogRegistry.find(d => d.dogId === analysis.matchedDogId);
        const isKnownDog = !!profile;

        // If new dog, register profile
        if (!profile) {
            profile = {
                dogId: analysis.matchedDogId,
                type: analysis.detectedType || "STRAY",
                name: analysis.detectedType === "PET" ? "Unknown Pet" : `Community Stray (${analysis.matchedDogId})`,
                caregiverPhone: DEFAULT_RESCUER_PHONE,
                vaccinationStatus: "🔴 Unknown / Overdue",
                healthStatus: analysis.isInjured ? "Injured" : "Healthy",
                lastSeen: new Date().toISOString().split('T')[0],
                medicalHistory: analysis.injuryDetected || "Initial scan recorded",
                visualSignature: analysis.visualAnalysis?.breedOrCoat || "Scanned features recorded"
            };

            dogRegistry.push(profile);
            writeJson('dog_registry.json', dogRegistry);
        } else {
            if (analysis.isInjured) {
                profile.healthStatus = "Injured";
            }
            profile.lastSeen = new Date().toISOString().split('T')[0];
            writeJson('dog_registry.json', dogRegistry);
        }

        // 2. INTELLIGENT MULTI-TIER EMERGENCY ROUTING ENGINE
        let routingDecision = {
            caseType: "",
            targetEntity: "",
            targetName: "",
            targetPhone: "",
            callTriggered: false,
            callScript: "",
            dispatchLogId: null,
            alertMessage: ""
        };

        const defaultRescuer = rescuers[0] || { name: "Mumbai Rapid Rescue NGO", phone: DEFAULT_RESCUER_PHONE };
        const defaultVet = vets[0] || { name: "Green Park Animal Clinic", phone: DEFAULT_VET_PHONE };

        if (isKnownDog) {
            if (analysis.isInjured) {
                // Case A1: Known Dog + Injured -> Outbound call to Owner
                const ownerPhone = profile.ownerPhone || profile.caregiverPhone || DEFAULT_PHONE;
                const ownerName = profile.ownerName || profile.name || "Pet Owner";

                routingDecision.caseType = "Case A (Known Dog) - Injured";
                routingDecision.targetEntity = "OWNER";
                routingDecision.targetName = ownerName;
                routingDecision.targetPhone = ownerPhone;
                routingDecision.callTriggered = true;
                routingDecision.callScript = `EMERGENCY ALERT for ${ownerName}: Your pet ${profile.name} (#${profile.dogId}) was scanned with detected injuries: '${analysis.injuryDetected}'. Please confirm if you need an emergency rescue team dispatched immediately.`;
                routingDecision.alertMessage = `Automated outbound voice call dispatched to Owner (${ownerPhone}). Awaiting owner rescue confirmation.`;

                const newDispatch = {
                    dispatchId: `DSP-${Date.now().toString().slice(-5)}`,
                    timestamp: new Date().toISOString(),
                    dogId: profile.dogId,
                    dogType: profile.type,
                    dogName: profile.name,
                    urgency: analysis.urgencyLevel || "HIGH",
                    injuryDetails: analysis.injuryDetected,
                    targetEntity: "OWNER",
                    targetName: ownerName,
                    targetPhone: ownerPhone,
                    status: "OWNER_CALLED_PENDING_CONFIRMATION",
                    notes: `Known dog scanned with trauma. Outbound call placed to owner ${ownerPhone}.`,
                    scannedLocation: scannedLocation,
                    proofPhoto: null
                };
                dispatchLogs.unshift(newDispatch);
                writeJson('dispatch_logs.json', dispatchLogs);
                routingDecision.dispatchLogId = newDispatch.dispatchId;

            } else {
                // Case A2: Known Dog + Healthy -> Vaccination check
                const isOverdue = !profile.vaccinationStatus || profile.vaccinationStatus.includes("Overdue") || profile.vaccinationStatus.includes("Unknown");
                routingDecision.caseType = "Case A (Known Dog) - Healthy";
                routingDecision.targetEntity = "OWNER";
                routingDecision.targetName = profile.ownerName || profile.name;
                routingDecision.targetPhone = profile.ownerPhone || profile.caregiverPhone || DEFAULT_PHONE;

                if (isOverdue) {
                    routingDecision.callTriggered = false;
                    routingDecision.alertMessage = `HEALTH ALERT: Dog #${profile.dogId} is healthy but Rabies/DHPP vaccination is OVERDUE (${profile.vaccinationStatus}). Health notification logged to owner dashboard.`;
                } else {
                    routingDecision.callTriggered = false;
                    routingDecision.alertMessage = `Dog #${profile.dogId} is healthy and vaccinations are UP-TO-DATE. Logged routine check-in.`;
                }
            }
        } else {
            if (analysis.isInjured) {
                // Case B1: Unknown Stray + Injured -> Call Nearest Rescuer / NGO
                routingDecision.caseType = "Case B (Unknown Stray) - Injured";
                routingDecision.targetEntity = "RESCUER";
                routingDecision.targetName = defaultRescuer.name;
                routingDecision.targetPhone = defaultRescuer.phone;
                routingDecision.callTriggered = true;
                routingDecision.callScript = `112 RESCUE DISPATCH: Unidentified stray #${profile.dogId} detected with high-urgency trauma: '${analysis.injuryDetected}'. Emergency ambulance dispatched to site.`;
                routingDecision.alertMessage = `EMERGENCY 112 DISPATCH: Direct voice call & hotline alert sent to Rescue NGO (${defaultRescuer.name} - ${defaultRescuer.phone}).`;

                const newDispatch = {
                    dispatchId: `DSP-${Date.now().toString().slice(-5)}`,
                    timestamp: new Date().toISOString(),
                    dogId: profile.dogId,
                    dogType: "STRAY",
                    dogName: profile.name,
                    urgency: "HIGH",
                    injuryDetails: analysis.injuryDetected,
                    targetEntity: "RESCUER",
                    targetName: defaultRescuer.name,
                    targetPhone: defaultRescuer.phone,
                    status: "DISPATCHED",
                    notes: `Unknown stray scanned with trauma. Direct hotline call triggered to ${defaultRescuer.name}.`,
                    scannedLocation: scannedLocation,
                    proofPhoto: null
                };
                dispatchLogs.unshift(newDispatch);
                writeJson('dispatch_logs.json', dispatchLogs);
                routingDecision.dispatchLogId = newDispatch.dispatchId;

            } else {
                // Case B2: Unknown Stray + Healthy + Outdated/Unknown Vaccination -> Call / Notify Nearest Vet Clinic
                routingDecision.caseType = "Case B (Unknown Stray) - Healthy / Unimmunized";
                routingDecision.targetEntity = "VET";
                routingDecision.targetName = defaultVet.name;
                routingDecision.targetPhone = defaultVet.phone;
                routingDecision.callTriggered = true;
                routingDecision.callScript = `COMMUNITY VET ALERT: Unimmunized stray #${profile.dogId} scanned at location. Vaccination status: Overdue/Unknown. Notification & dispatch request sent to ${defaultVet.name}.`;
                routingDecision.alertMessage = `VET CLINIC ALERT: Notification & Call triggered to Nearest Clinic (${defaultVet.name} - ${defaultVet.phone}) for rabies immunization.`;

                const newDispatch = {
                    dispatchId: `DSP-${Date.now().toString().slice(-5)}`,
                    timestamp: new Date().toISOString(),
                    dogId: profile.dogId,
                    dogType: "STRAY",
                    dogName: profile.name,
                    urgency: "MEDIUM",
                    injuryDetails: "None (Rabies Vaccination Required)",
                    targetEntity: "VET",
                    targetName: defaultVet.name,
                    targetPhone: defaultVet.phone,
                    status: "VET_ALERTED",
                    notes: `Unimmunized stray logged for street vaccination drive. Alert sent to ${defaultVet.name}.`,
                    scannedLocation: scannedLocation,
                    proofPhoto: null
                };
                dispatchLogs.unshift(newDispatch);
                writeJson('dispatch_logs.json', dispatchLogs);
                routingDecision.dispatchLogId = newDispatch.dispatchId;
            }
        }

        // TRIGGER OUTBOUND VOICE CALL IF CALL IS TRIGGERED
        if (routingDecision.callTriggered) {
            const callResult = await makeOutboundCall(
                process.env.DEMO_TARGET_PHONE || routingDecision.targetPhone,
                routingDecision.callScript
            );
            routingDecision.callResult = callResult;
        }

        // 3. SOLANA DEVNET ANCHORING
        let solanaTxSignature = "simulated_solana_tx_" + crypto.randomBytes(8).toString('hex');
        try {
            const connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl('devnet'), 'confirmed');
            const payer = solanaWeb3.Keypair.generate();
            const airdropSignature = await connection.requestAirdrop(payer.publicKey, solanaWeb3.LAMPORTS_PER_SOL / 10);
            await connection.confirmTransaction(airdropSignature);

            const recordData = JSON.stringify({ dogId: profile.dogId, status: profile.vaccinationStatus, time: Date.now() });
            const dataHash = crypto.createHash('sha256').update(recordData).digest('hex');

            const transaction = new solanaWeb3.Transaction().add(
                new solanaWeb3.TransactionInstruction({
                    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
                    programId: new solanaWeb3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
                    data: Buffer.from(`PawID Hash: ${dataHash}`, 'utf-8'),
                })
            );

            solanaTxSignature = await solanaWeb3.sendAndConfirmTransaction(connection, transaction, [payer]);
        } catch (solanaErr) {
            console.log("Solana Devnet fallback notice:", solanaErr.message);
        }

        // 4. SNOWFLAKE ANALYTICS CALCULATIONS
        let herdImmunityScore = calculateHerdImmunityScore();
        try {
            await executeSnowflakeQuery(
                `INSERT INTO dog_scans (dog_id, scan_type, vaccination_status, timestamp) VALUES (?, ?, ?, CURRENT_TIMESTAMP())`,
                [profile.dogId, profile.type, profile.vaccinationStatus]
            );
        } catch (sfErr) {
            // Fallback score calculation handled above
        }

        return res.json({
            success: true,
            analysis,
            profile,
            routingDecision,
            solanaTx: solanaTxSignature,
            herdImmunityScore
        });

    } catch (error) {
        console.error("Server Error in /api/report-dog:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// INTERACTIVE CALL CASCADE & CONFIRMATION (POST /api/confirm-rescue)
router.post('/confirm-rescue', async (req, res) => {
    const { dispatchId, confirmRescue } = req.body;
    let dispatchLogs = readJson('dispatch_logs.json');
    let rescuers = readJson('rescuers.json');

    const logIndex = dispatchLogs.findIndex(d => d.dispatchId === dispatchId);
    if (logIndex === -1) {
        return res.status(404).json({ success: false, error: "Dispatch record not found." });
    }

    const targetRescuer = rescuers[0] || { name: "Mumbai Rapid Rescue NGO", phone: DEFAULT_RESCUER_PHONE };

    if (confirmRescue) {
        dispatchLogs[logIndex].status = "DISPATCHED";
        dispatchLogs[logIndex].targetEntity = "RESCUER";
        dispatchLogs[logIndex].targetName = targetRescuer.name;
        dispatchLogs[logIndex].targetPhone = targetRescuer.phone;
        dispatchLogs[logIndex].notes += ` | Owner confirmed rescue team dispatch. Escalated to ${targetRescuer.name}.`;
        writeJson('dispatch_logs.json', dispatchLogs);

        const callScript = `EMERGENCY 112 RESCUE ESCALATION: Owner has confirmed emergency dispatch for pet #${dispatchLogs[logIndex].dogId}. Immediate ambulance requested.`;
        const callResult = await makeOutboundCall(
            process.env.DEMO_TARGET_PHONE || targetRescuer.phone,
            callScript
        );

        return res.json({
            success: true,
            message: `Owner confirmed dispatch. Emergency call cascaded to ${targetRescuer.name} (${process.env.DEMO_TARGET_PHONE || targetRescuer.phone}).`,
            dispatchLog: dispatchLogs[logIndex],
            callResult
        });
    } else {
        dispatchLogs[logIndex].status = "OWNER_DECLINED_RESCUE";
        dispatchLogs[logIndex].notes += " | Owner indicated they will handle transport independently.";
        writeJson('dispatch_logs.json', dispatchLogs);

        return res.json({
            success: true,
            message: "Owner declined rescue dispatch. Log updated.",
            dispatchLog: dispatchLogs[logIndex]
        });
    }
});

module.exports = router;
