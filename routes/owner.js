const express = require('express');
const router = express.Router();
const { readJson, writeJson } = require('../utils/storage');

// GET OWNER PETS & ALERTS (GET /api/owner/pets/:username)
router.get('/pets/:username', (req, res) => {
    const dogRegistry = readJson('dog_registry.json');
    const dispatchLogs = readJson('dispatch_logs.json');

    const username = req.params.username;
    const pet = dogRegistry.find(d => d.credentials && d.credentials.username.toLowerCase() === username.toLowerCase());

    if (!pet) {
        return res.status(404).json({ success: false, error: "Owner pet profile not found." });
    }

    const petDispatches = dispatchLogs.filter(d => d.dogId === pet.dogId);

    return res.json({
        success: true,
        pet,
        alerts: petDispatches
    });
});

// UPDATE OWNER PROFILE PHONE & PET DETAILS (PUT /api/owner/profile)
router.put('/profile', (req, res) => {
    // 0. Role-Based Access Control
    let authHeader = req.headers['authorization'] || req.headers['x-user-role'] || req.headers['role'];
    let headerRole = null;
    if (authHeader && typeof authHeader === 'string') {
        headerRole = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
    }
    const role = req.body.userRole || req.body.role || headerRole;

    if (role && typeof role === 'string' && role.trim().toUpperCase() !== 'OWNER') {
        return res.status(403).json({ 
            success: false, 
            error: "Forbidden: Access denied. You must be logged in as an authorized Pet Owner." 
        });
    }

    const username = req.body.username || req.headers['x-user-username'] || req.headers['x-username'];
    const { ownerPhone, ownerName, name, petName, dogId, petId } = req.body;

    // 1. Strict Owner Username Validation
    if (!username || typeof username !== 'string' || !username.trim()) {
        return res.status(403).json({ 
            success: false, 
            error: "Forbidden: Missing owner username authorization." 
        });
    }

    let dogRegistry = readJson('dog_registry.json');

    // 2. Locate Pet Registered to Logged-in Owner
    const petIndex = dogRegistry.findIndex(d => 
        d.credentials && d.credentials.username.toLowerCase() === username.trim().toLowerCase()
    );

    if (petIndex === -1) {
        return res.status(403).json({ 
            success: false, 
            error: "Forbidden: User is not authorized as a registered pet owner." 
        });
    }

    const ownerPet = dogRegistry[petIndex];

    // 3. Strict Pet-Specific Ownership Verification (if dogId/petId target is supplied)
    const targetDogId = dogId || petId;
    if (targetDogId && targetDogId.toLowerCase() !== ownerPet.dogId.toLowerCase()) {
        return res.status(403).json({ 
            success: false, 
            error: "Forbidden: You are only authorized to update details for your specific registered pet." 
        });
    }

    // 4. Update Allowed Pet & Contact Details Only
    if (ownerPhone !== undefined) dogRegistry[petIndex].ownerPhone = ownerPhone;
    if (ownerName !== undefined) dogRegistry[petIndex].ownerName = ownerName;
    if (name !== undefined) dogRegistry[petIndex].name = name;
    if (petName !== undefined) dogRegistry[petIndex].name = petName;

    writeJson('dog_registry.json', dogRegistry);

    return res.json({
        success: true,
        message: "Owner contact and pet details updated successfully.",
        pet: dogRegistry[petIndex]
    });
});

module.exports = router;
