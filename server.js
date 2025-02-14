import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import csv from 'csv-parser';
import { Readable } from 'stream';

const app = express();
app.use(express.json());
app.use(cors());

// Configure multer to store files in memory
const upload = multer({ storage: multer.memoryStorage() });

/**
 * Helper function to parse CSV data from a Buffer.
 * Returns a Promise that resolves with the parsed results.
 */
function parseCSVFromBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const results = [];
    const stream = Readable.from(buffer.toString());
    stream
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
}

/**
 * Parse employees CSV file.
 * Each row should include Employee_Name and Employee_EmailID.
 */
async function parseEmployees(buffer) {
  const data = await parseCSVFromBuffer(buffer);
  return data.map(row => ({
    Employee_Name: row.Employee_Name,
    Employee_EmailID: row.Employee_EmailID
  }));
}

/**
 * Parse previous assignments CSV file.
 * Each row should include Employee_EmailID and Secret_Child_EmailID.
 * Returns an object mapping Employee_EmailID => Secret_Child_EmailID.
 */
async function parsePreviousAssignments(buffer) {
  const data = await parseCSVFromBuffer(buffer);
  const assignments = {};
  data.forEach(row => {
    assignments[row.Employee_EmailID] = row.Secret_Child_EmailID;
  });
  return assignments;
}

/**
 * Helper function to shuffle an array using the Fisher–Yates algorithm.
 */
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Generate Secret Santa assignments.
 * Ensures:
 *  - No one is assigned to themselves.
 *  - Previous assignments (if provided) are not repeated.
 */
function generateAssignments(employees, previousAssignments) {
  const maxAttempts = 1000;
  let assignments = [];
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let shuffled = shuffle([...employees]);
    let valid = true;
    assignments = [];
    
    for (let i = 0; i < employees.length; i++) {
      const giver = employees[i];
      const receiver = shuffled[i];
      
      // Constraint 1: Cannot assign to self.
      if (giver.Employee_EmailID === receiver.Employee_EmailID) {
        valid = false;
        break;
      }
      
      // Constraint 2: Avoid previous year's assignment if provided.
      if (
        previousAssignments[giver.Employee_EmailID] &&
        previousAssignments[giver.Employee_EmailID] === receiver.Employee_EmailID
      ) {
        valid = false;
        break;
      }
      
      assignments.push({ employee: giver, secretChild: receiver });
    }
    
    if (valid) return assignments;
  }
  
  throw new Error('Unable to generate valid assignments after many attempts');
}

/**
 * POST /api/secret-santa/assign
 * Expects:
 *   - employeesFile: CSV file with Employee_Name and Employee_EmailID.
 *   - previousAssignmentsFile (optional): CSV with previous assignments.
 * Returns a CSV file with the new assignments.
 */
app.post('/api/secret-santa/assign', upload.fields([
  { name: 'employeesFile', maxCount: 1 },
  { name: 'previousAssignmentsFile', maxCount: 1 }
]), async (req, res) => {
  try {
    if (!req.files || !req.files.employeesFile) {
      return res.status(400).json({ error: 'Employees CSV file is required.' });
    }
    
    // Parse employees file
    const employeesBuffer = req.files.employeesFile[0].buffer;
    const employeesData = await parseEmployees(employeesBuffer);
    
    // Parse previous assignments if provided
    let previousAssignments = {};
    if (req.files.previousAssignmentsFile) {
      const prevBuffer = req.files.previousAssignmentsFile[0].buffer;
      previousAssignments = await parsePreviousAssignments(prevBuffer);
    }
    
    // Generate assignments
    const assignments = generateAssignments(employeesData, previousAssignments);
    
    // Build CSV output
    let csvOutput = 'Employee_Name,Employee_EmailID,Secret_Child_Name,Secret_Child_EmailID\n';
    assignments.forEach(assignment => {
      csvOutput += `${assignment.employee.Employee_Name},${assignment.employee.Employee_EmailID},${assignment.secretChild.Employee_Name},${assignment.secretChild.Employee_EmailID}\n`;
    });
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="secret_santa_assignments.csv"');
    res.status(200).send(csvOutput);
    
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'An error occurred during assignment.' });
  }
});

// Start the server on the defined PORT
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
