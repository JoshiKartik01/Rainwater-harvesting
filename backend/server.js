
const express = require("express");
const cors = require("cors");
const pool = require("./db");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Home route
app.get("/", (req, res) => {
    res.send("RainWise Backend is running!");
});

// Test MySQL connection
app.get("/api/test-db", async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT DATABASE() AS database_name"
        );

        res.json({
            success: true,
            message: "MySQL connected successfully!",
            database: rows[0].database_name
        });
    } catch (error) {
        console.error("Database error:", error.message);

        res.status(500).json({
            success: false,
            message: "Database connection failed."
        });
    }
});

// Register the default building and tank
app.post("/api/setup", async (req, res) => {
    let connection;

    try {
        const roofArea = Number(req.body.roof_area_sq_m ?? 1000);

        if (!Number.isFinite(roofArea) || roofArea <= 0) {
            return res.status(400).json({
                success: false,
                message: "Roof area must be greater than zero."
            });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [buildings] = await connection.execute(
            `SELECT building_id
             FROM buildings
             WHERE building_name = ?
             AND location = ?
             LIMIT 1`,
            ["GEHU Academic Block", "Dehradun"]
        );

        let buildingId;

        if (buildings.length > 0) {
            buildingId = buildings[0].building_id;
        } else {
            const [result] = await connection.execute(
                `INSERT INTO buildings
                 (building_name, location, roof_area_sq_m, runoff_coefficient)
                 VALUES (?, ?, ?, ?)`,
                ["GEHU Academic Block", "Dehradun", roofArea, 0.85]
            );

            buildingId = result.insertId;
        }

        const [tanks] = await connection.execute(
            `SELECT tank_id
             FROM tanks
             WHERE building_id = ?
             AND tank_name = ?
             LIMIT 1`,
            [buildingId, "Main Rainwater Tank"]
        );

        let tankId;

        if (tanks.length > 0) {
            tankId = tanks[0].tank_id;
        } else {
            const [result] = await connection.execute(
                `INSERT INTO tanks
                 (building_id, tank_name, capacity_l, initial_storage_l)
                 VALUES (?, ?, ?, ?)`,
                [buildingId, "Main Rainwater Tank", 10000, 2000]
            );

            tankId = result.insertId;
        }

        await connection.commit();

        res.json({
            success: true,
            message: "RainWise building and tank setup completed!",
            building_id: buildingId,
            tank_id: tankId
        });

    } catch (error) {
        if (connection) await connection.rollback();

        console.error("Setup error:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not complete building and tank setup."
        });

    } finally {
        if (connection) connection.release();
    }
});

// Save a simulation and all its daily results
app.post("/api/simulations", async (req, res) => {
    let connection;

    try {
        const {
            simulation_name,
            start_date,
            rainfall_source,
            config,
            rows
        } = req.body;

        // Validate required information
        if (
            !config ||
            !Array.isArray(rows) ||
            rows.length < 1 ||
            rows.length > 365
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid simulation data."
            });
        }

        const simulationName =
            String(simulation_name || "RainWise Simulation").trim();

        if (!simulationName || simulationName.length > 120) {
            return res.status(400).json({
                success: false,
                message: "Simulation name must contain 1 to 120 characters."
            });
        }

        if (
            typeof start_date !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(start_date)
        ) {
            return res.status(400).json({
                success: false,
                message: "A valid start date is required (YYYY-MM-DD)."
            });
        }

        const startDateObject = new Date(`${start_date}T00:00:00.000Z`);

        if (
            Number.isNaN(startDateObject.getTime()) ||
            startDateObject.toISOString().slice(0, 10) !== start_date
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid start date."
            });
        }

        const roofArea = Number(config.roofArea);
        const capacity = Number(config.capacity);
        const runoff = Number(config.runoff);
        const efficiency = Number(config.efficiency);
        const startingStorage = Number(config.startStorage);
        const dailyDemand = Number(config.dailyDemand);

        if (
            !Number.isFinite(roofArea) || roofArea <= 0 ||
            !Number.isFinite(capacity) || capacity <= 0 ||
            !Number.isFinite(runoff) || runoff < 0 || runoff > 1 ||
            !Number.isFinite(efficiency) || efficiency < 0 || efficiency > 1 ||
            !Number.isFinite(startingStorage) ||
            startingStorage < 0 || startingStorage > capacity ||
            !Number.isFinite(dailyDemand) || dailyDemand < 0
        ) {
            return res.status(400).json({
                success: false,
                message: "One or more simulation settings are invalid."
            });
        }

        const numericFields = [
            "rainfall", "potential", "inflow", "used",
            "overflow", "demand", "unmet",
            "startStorage", "endingStorage"
        ];

        for (const row of rows) {
            if (!row || numericFields.some(field =>
                !Number.isFinite(Number(row[field])) ||
                Number(row[field]) < 0
            )) {
                return res.status(400).json({
                    success: false,
                    message: "Daily results contain invalid values."
                });
            }
        }

        if (rows.some(row => Number(row.rainfall) > 2000)) {
            return res.status(400).json({
                success: false,
                message: "Daily rainfall cannot exceed 2,000 mm."
            });
        }

        const endDateObject = new Date(startDateObject);
        endDateObject.setUTCDate(
            endDateObject.getUTCDate() + rows.length - 1
        );
        const endDate = endDateObject.toISOString().slice(0, 10);

        // Calculate totals from the daily rows
        const totals = rows.reduce((sum, row) => {
            sum.rainfall += Number(row.rainfall);
            sum.collected += Number(row.inflow);
            sum.used += Number(row.used);
            sum.overflow += Number(row.overflow);
            sum.unmet += Number(row.unmet);
            return sum;
        }, {
            rainfall: 0,
            collected: 0,
            used: 0,
            overflow: 0,
            unmet: 0
        });

        const finalStorage = Number(rows[rows.length - 1].endingStorage);

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Find the one configured GEHU building
        const [buildings] = await connection.execute(
            `SELECT building_id
             FROM buildings
             WHERE building_name = ?
             AND location = ?
             LIMIT 1`,
            ["GEHU Academic Block", "Dehradun"]
        );

        if (buildings.length === 0) {
            throw new Error("Building not found. Run the setup API first.");
        }

        const buildingId = buildings[0].building_id;

        // Find its one configured tank
        const [tanks] = await connection.execute(
            `SELECT tank_id
             FROM tanks
             WHERE building_id = ?
             AND tank_name = ?
             LIMIT 1`,
            [buildingId, "Main Rainwater Tank"]
        );

        if (tanks.length === 0) {
            throw new Error("Tank not found. Run the setup API first.");
        }

        const tankId = tanks[0].tank_id;

        // Keep the building and tank settings in sync with this simulation
        await connection.execute(
            `UPDATE buildings
             SET roof_area_sq_m = ?, runoff_coefficient = ?
             WHERE building_id = ?`,
            [roofArea, runoff, buildingId]
        );

        await connection.execute(
            `UPDATE tanks
             SET capacity_l = ?, initial_storage_l = ?
             WHERE tank_id = ?`,
            [capacity, startingStorage, tankId]
        );

        // Save the simulation summary
        const [simulationResult] = await connection.execute(
            `INSERT INTO simulation_runs (
                building_id,
                tank_id,
                simulation_name,
                start_date,
                end_date,
                rainfall_source,
                daily_demand_l,
                total_rainfall_mm,
                total_collected_l,
                total_water_used_l,
                total_overflow_l,
                unmet_demand_l,
                final_storage_l
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                buildingId,
                tankId,
                simulationName,
                start_date,
                endDate,
                rainfall_source === "Open-Meteo" ? "Open-Meteo" : "Manual",
                dailyDemand,
                totals.rainfall,
                totals.collected,
                totals.used,
                totals.overflow,
                totals.unmet,
                finalStorage
            ]
        );

        const simulationId = simulationResult.insertId;

        // Save each day's result
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];

            const resultDate = new Date(startDateObject);
            resultDate.setUTCDate(resultDate.getUTCDate() + i);

            const dateString = resultDate.toISOString().slice(0, 10);

            await connection.execute(
                `INSERT INTO daily_results (
                    simulation_id,
                    result_date,
                    rainfall_mm,
                    potential_runoff_l,
                    collected_l,
                    opening_storage_l,
                    water_used_l,
                    overflow_l,
                    unmet_demand_l,
                    closing_storage_l
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    simulationId,
                    dateString,
                    Number(row.rainfall),
                    Number(row.potential),
                    Number(row.inflow),
                    Number(row.startStorage),
                    Number(row.used),
                    Number(row.overflow),
                    Number(row.unmet),
                    Number(row.endingStorage)
                ]
            );
        }

        await connection.commit();

        res.status(201).json({
            success: true,
            message: "Simulation saved successfully!",
            simulation_id: simulationId,
            building_id: buildingId,
            tank_id: tankId,
            total_days: rows.length,
            start_date: start_date,
            end_date: endDate
        });

    } catch (error) {
        if (connection) await connection.rollback();

        console.error("Save simulation error:", error.message);

        res.status(500).json({
            success: false,
            message: error.message || "Could not save simulation."
        });

    } finally {
        if (connection) connection.release();
    }
});


// Get all saved simulations
app.get("/api/simulations", async (req, res) => {
    try {
        const [simulations] = await pool.execute(`
            SELECT
                s.simulation_id,
                s.simulation_name,
                s.start_date,
                s.end_date,
                s.rainfall_source,
                s.daily_demand_l,
                s.total_rainfall_mm,
                s.total_collected_l,
                s.total_water_used_l,
                s.total_overflow_l,
                s.unmet_demand_l,
                s.final_storage_l,
                s.created_at,
                b.building_name,
                t.tank_name
            FROM simulation_runs s
            JOIN buildings b
                ON s.building_id = b.building_id
            JOIN tanks t
                ON s.tank_id = t.tank_id
            ORDER BY s.simulation_id DESC
        `);

        res.json({
            success: true,
            count: simulations.length,
            simulations: simulations
        });

    } catch (error) {
        console.error("History error:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not retrieve simulation history."
        });
    }
});


// Get daily details of one simulation
app.get("/api/simulations/:id", async (req, res) => {
    try {
        const simulationId = Number(req.params.id);

        if (!Number.isInteger(simulationId) || simulationId <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid simulation ID."
            });
        }

        const [simulations] = await pool.execute(
            `SELECT *
             FROM simulation_runs
             WHERE simulation_id = ?`,
            [simulationId]
        );

        if (simulations.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Simulation not found."
            });
        }

        const [dailyResults] = await pool.execute(
            `SELECT *
             FROM daily_results
             WHERE simulation_id = ?
             ORDER BY result_date ASC`,
            [simulationId]
        );

        res.json({
            success: true,
            simulation: simulations[0],
            daily_results: dailyResults
        });

    } catch (error) {
        console.error("Simulation details error:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not retrieve simulation details."
        });
    }
});

const PORT = process.env.PORT || 5000;

// DELETE A SAVED SIMULATION
app.delete("/api/simulations/:id", async (req, res) => {
    try {
        const simulationId = Number(req.params.id);

        if (!Number.isInteger(simulationId) || simulationId <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid simulation ID."
            });
        }

        const [result] = await pool.execute(
            "DELETE FROM simulation_runs WHERE simulation_id = ?",
            [simulationId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Simulation not found."
            });
        }

        res.json({
            success: true,
            message: "Simulation and its daily records deleted successfully."
        });

    } catch (error) {
        console.error("Delete simulation error:", error);

        res.status(500).json({
            success: false,
            message: "Could not delete simulation."
        });
    }
});

app.listen(PORT, () => {
    console.log(`RainWise server running at http://localhost:${PORT}`);
});
