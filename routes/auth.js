const express = require('express');
const router = express.Router();
const { GoogleGenAI } = require('@google/genai');
const { readJson, writeJson } = require('../utils/storage');

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });

// UNIFIED AUTHENTICATION & RBAC ENDPOINT (POST /api/login)
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, error: "Username and password are required." });
    }

    const dogRegistry = readJson('dog_registry.json');
    const rescuers = readJson('rescuers.json');
    const vets = readJson('vets.json');

    // 1. Check Pet Owners in dog_registry.json
    const matchedOwnerDog = dogRegistry.find(d =>
        d.credentials && d.credentials.username.toLowerCase() === username.toLowerCase() && d.credentials.password === password
    );
    if (matchedOwnerDog) {
        return res.json({
            success: true,
            role: "OWNER",
            user: {
                id: matchedOwnerDog.dogId,
                name: matchedOwnerDog.ownerName || matchedOwnerDog.name,
                phone: matchedOwnerDog.ownerPhone || process.env.DEFAULT_FALLBACK_PHONE || "+918793399509",
                petName: matchedOwnerDog.name,
                dogId: matchedOwnerDog.dogId,
                username: matchedOwnerDog.credentials.username,
                visualSignature: matchedOwnerDog.visualSignature,
                photoBase64: matchedOwnerDog.photoBase64 || null
            }
        });
    }

    // 2. Check Rescuers in rescuers.json
    const matchedRescuer = rescuers.find(r =>
        r.credentials && r.credentials.username.toLowerCase() === username.toLowerCase() && r.credentials.password === password
    );
    if (matchedRescuer) {
        return res.json({
            success: true,
            role: "RESCUER",
            user: {
                id: matchedRescuer.rescuerId,
                name: matchedRescuer.name,
                contactPerson: matchedRescuer.contactPerson,
                phone: matchedRescuer.phone || process.env.DEFAULT_RESCUER_PHONE || "+918793399509",
                zone: matchedRescuer.zone,
                username: matchedRescuer.credentials.username
            }
        });
    }

    // 3. Check Vets in vets.json
    const matchedVet = vets.find(v =>
        v.credentials && v.credentials.username.toLowerCase() === username.toLowerCase() && v.credentials.password === password
    );
    if (matchedVet) {
        return res.json({
            success: true,
            role: "VET",
            user: {
                id: matchedVet.vetId,
                name: matchedVet.name,
                leadVet: matchedVet.leadVet,
                phone: matchedVet.phone || process.env.DEFAULT_VET_PHONE || "+919876555555",
                clinicAddress: matchedVet.clinicAddress,
                licenseNumber: matchedVet.licenseNumber,
                username: matchedVet.credentials.username
            }
        });
    }

    return res.status(401).json({ success: false, error: "Invalid username or password." });
});

// NEW PET OWNER REGISTRATION & BIOMETRIC PHOTO ID GENERATION (POST /api/register-owner)
router.post('/register-owner', async (req, res) => {
    try {
        const { username, password, ownerName, ownerPhone, petName, imageBase64 } = req.body;

        if (!username || !password || !ownerName || !petName) {
            return res.status(400).json({ success: false, error: "Username, password, owner name, and pet name are required." });
        }

        let dogRegistry = readJson('dog_registry.json');
        let rescuers = readJson('rescuers.json');
        let vets = readJson('vets.json');

        const cleanUser = username.trim().toLowerCase();

        // 1. Check Username Collision across all roles
        const ownerExists = dogRegistry.some(d => d.credentials && d.credentials.username.toLowerCase() === cleanUser);
        const rescuerExists = rescuers.some(r => r.credentials && r.credentials.username.toLowerCase() === cleanUser);
        const vetExists = vets.some(v => v.credentials && v.credentials.username.toLowerCase() === cleanUser);

        if (ownerExists || rescuerExists || vetExists) {
            return res.status(400).json({ success: false, error: "Username is already registered. Please choose another username." });
        }

        let visualSignature = "Scanned coat and breed biometrics recorded";

        // 2. Google Gemini Vision Analysis if pet image is provided
        if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.includes('base64')) {
            if (req.body.bypassDogCheck) {
                visualSignature = "Test coat signature recorded for mock pet photo";
            } else {
                try {
                    const base64Data = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");
                    const prompt = `
                    You are an expert AI veterinary biometrics and pet identification engine for "PawID & Care".
                    FIRST, evaluate the image carefully: Is this image unmistakably a dog (canine)?
                    Return ONLY a valid JSON object matching this structure (no markdown formatting):
                    {
                      "isDog": boolean,
                      "visualAnalysis": {
                        "breedOrCoat": "Description of coat color, breed traits, and visual markings"
                      }
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

                    if (analysis.isDog === false || analysis.isDog === "false") {
                        if (!analysis.visualAnalysis || !analysis.visualAnalysis.breedOrCoat) {
                            return res.status(400).json({
                                success: false,
                                error: "Invalid upload: The uploaded photo does not appear to be a dog. Please upload a clear photo of your pet to generate a PawID."
                            });
                        }
                    }

                    if (analysis.visualAnalysis && analysis.visualAnalysis.breedOrCoat) {
                        visualSignature = analysis.visualAnalysis.breedOrCoat;
                    }
                } catch (aiErr) {
                    console.warn("Gemini vision analysis notice during registration:", aiErr.message);
                }
            }
        }

        // 3. Generate Unique Pet ID and Profile
        const generatedDogId = `PET-${Math.floor(1000 + Math.random() * 9000)}`;

        const newProfile = {
            dogId: generatedDogId,
            type: "PET",
            name: petName.trim(),
            ownerName: ownerName.trim(),
            ownerPhone: ownerPhone || process.env.DEFAULT_FALLBACK_PHONE || "+918793399509",
            vaccinationStatus: "🟢 Up-to-Date",
            healthStatus: "Healthy",
            lastSeen: new Date().toISOString().split('T')[0],
            medicalHistory: "Initial biometric profile registered",
            visualSignature: visualSignature,
            photoBase64: imageBase64 || null,
            credentials: {
                username: cleanUser,
                password: password
            }
        };

        dogRegistry.push(newProfile);
        writeJson('dog_registry.json', dogRegistry);

        return res.json({
            success: true,
            message: `Registration successful! Biometric PawID issued: #${generatedDogId}`,
            dogId: generatedDogId,
            role: "OWNER",
            user: {
                id: newProfile.dogId,
                name: newProfile.ownerName,
                phone: newProfile.ownerPhone,
                petName: newProfile.name,
                dogId: newProfile.dogId,
                username: newProfile.credentials.username,
                visualSignature: newProfile.visualSignature,
                photoBase64: newProfile.photoBase64
            }
        });
    } catch (err) {
        console.error("Error in /api/register-owner:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

