const express = require('express');
const router = express.Router();
const { readJson, writeJson, calculateHerdImmunityScore } = require('../utils/storage');

// GET UNIMMUNIZED STRAYS RADAR LIST (GET /api/vet/unimmunized-strays)
router.get('/unimmunized-strays', (req, res) => {
    const dogRegistry = readJson('dog_registry.json');
    const strays = dogRegistry.filter(d =>
        d.vaccinationStatus && (d.vaccinationStatus.includes("Overdue") || d.vaccinationStatus.includes("Unknown"))
    );
    const herdImmunityScore = calculateHerdImmunityScore();

    return res.json({
        success: true,
        strays,
        herdImmunityScore
    });
});

// GET VACCINATION RECORDS HISTORY (GET /api/vet/records)
router.get('/records', (req, res) => {
    const vaccinations = readJson('vaccinations.json');
    return res.json({
        success: true,
        vaccinations
    });
});

// RECORD ADMINISTERED VACCINATION (POST /api/vet/vaccinate)
router.post('/vaccinate', (req, res) => {
    // 1. Role-Based Access Control: Require VET Role
    let authHeader = req.headers['authorization'] || req.headers['x-user-role'] || req.headers['role'];
    let headerRole = null;
    if (authHeader && typeof authHeader === 'string') {
        headerRole = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
    }

    const role = req.body.userRole || req.body.role || headerRole;
    const username = req.body.username || req.headers['x-user-username'] || req.headers['x-username'];

    let isAuthorizedVet = (role && typeof role === 'string' && role.trim().toUpperCase() === 'VET');

    if (!isAuthorizedVet && username) {
        const vets = readJson('vets.json');
        const matchedVet = vets.find(v => 
            v.credentials && v.credentials.username.toLowerCase() === username.trim().toLowerCase()
        );
        if (matchedVet && (!role || role.trim().toUpperCase() === 'VET')) {
            isAuthorizedVet = true;
        }
    }

    if (!isAuthorizedVet) {
        return res.status(403).json({ 
            success: false, 
            error: "Access denied. You must be logged in as an authorized Vet Clinic to record vaccinations." 
        });
    }

    const { dogId, vetId, vetName, vaccineType, batchNumber, nextDueDate } = req.body;

    if (!dogId || !vaccineType) {
        return res.status(400).json({ success: false, error: "Dog ID and Vaccine Type are required." });
    }

    let dogRegistry = readJson('dog_registry.json');
    let vaccinations = readJson('vaccinations.json');

    // 1. Log Vaccination Entry
    const newRecord = {
        recordId: `VAC-${Date.now().toString().slice(-4)}`,
        timestamp: new Date().toISOString(),
        dogId,
        vetId: vetId || "VET-001",
        vetName: vetName || "Green Park Animal Clinic",
        vaccineType,
        batchNumber: batchNumber || `BATCH-${Math.floor(1000 + Math.random() * 9000)}`,
        nextDueDate: nextDueDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    };

    vaccinations.unshift(newRecord);
    writeJson('vaccinations.json', vaccinations);

    // 2. Update Dog Registry Vaccination Status
    const dogIndex = dogRegistry.findIndex(d => d.dogId === dogId);
    if (dogIndex !== -1) {
        dogRegistry[dogIndex].vaccinationStatus = "🟢 Up-to-Date";
        dogRegistry[dogIndex].lastVaccinated = new Date().toISOString().split('T')[0];
        writeJson('dog_registry.json', dogRegistry);
    }

    const updatedHerdImmunityScore = calculateHerdImmunityScore();

    return res.json({
        success: true,
        message: `Vaccination successfully recorded for #${dogId}!`,
        record: newRecord,
        updatedHerdImmunityScore
    });
});

module.exports = router;
