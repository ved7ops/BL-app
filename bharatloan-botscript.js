// BharatLoan Optimized WhatsApp Loan Application Flow Script

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const FormData = require("form-data");
const app = express();
app.use(bodyParser.json());

const sessions = {}; // Stores user sessions temporarily
const sessionTimeout = 20 * 60 * 1000; // Session timeout after 20 minutes

const API_BASE_URL = "https://preprod-node.bharatloanfintech.com/journey-service/api/v1/";
const API_HEADERS = { "Content-Type": "application/json" };

// Utility: Sends WhatsApp messages
async function sendMessage(mobile, text, quickReplies = []) {
  const payload = { mobile, text, quickReplies };
  console.log(`Sending message to ${mobile}:`, text);
  return axios.post("https://bl-app.onrender.com/send-message", payload);
}

// Utility: Cleans up sessions
function resetSession(mobile) {
  console.log(`Resetting session for ${mobile}`);
  delete sessions[mobile];
}

// API Handlers
async function sendOTP(mobileNumber) {
  try {
    const response = await axios.post(`${API_BASE_URL}send-otp`, { mobileNumber });
    return response.data;
  } catch (error) {
    console.error("Error sending OTP:", error);
    return { success: false };
  }
}

async function verifyOTP(mobileNumber, otp) {
  try {
    const response = await axios.post(`${API_BASE_URL}verify-otp`, { mobileNumber, otp });
    return response.data;
  } catch (error) {
    console.error("Error verifying OTP:", error);
    return null;
  }
}

async function checkServiceAvailability(pincode, token) {
  try {
    const response = await axios.post(`${API_BASE_URL}check-service`, { pincode }, { headers: { Authorization: `Bearer ${token}` } });
    return response.data;
  } catch (error) {
    console.error("Service check error:", error);
    return { success: false };
  }
}

async function createLead(details, token, custId) {
  try {
    const response = await axios.post(`${API_BASE_URL}create-lead`, { ...details, custId }, { headers: { Authorization: `Bearer ${token}` } });
    return response.data;
  } catch (error) {
    console.error("Lead creation error:", error);
    return { success: false };
  }
}

// Webhook endpoint
app.post("/webhook", async (req, res) => {
  const { mobile, message } = req.body;
  let session = sessions[mobile] || { step: "start", lastActivity: Date.now() };

  // Check for session timeout
  if (Date.now() - session.lastActivity > sessionTimeout) {
    resetSession(mobile);
    session = { step: "start" };
  }

  session.lastActivity = Date.now();

  try {
    switch (session.step) {
      case "start":
        if (message.toLowerCase() === "hi") {
          await sendMessage(mobile, "Welcome to BharatLoan! How can we assist you?", [
            { text: "Apply for Loan" },
            { text: "Talk to Live Agent" },
          ]);
          session.step = "menu";
        }
        break;

      case "menu":
        if (message === "Apply for Loan") {
          await sendMessage(mobile, "Please enter your 10-digit Mobile Number to proceed.");
          session.step = "enter_mobile";
        } else if (message === "Talk to Live Agent") {
          await sendMessage(mobile, "Connecting you to a live agent...");
          resetSession(mobile);
        }
        break;

      case "enter_mobile":
        if (/^\d{10}$/.test(message)) {
          session.mobileNumber = message;
          const otpResponse = await sendOTP(session.mobileNumber);
          if (otpResponse.success) {
            await sendMessage(mobile, "Please enter the OTP sent to your mobile number.");
            session.step = "enter_otp";
          } else {
            await sendMessage(mobile, "Failed to send OTP. Please try again.");
          }
        } else {
          await sendMessage(mobile, "Invalid mobile number. Please enter a valid 10-digit number.");
        }
        break;

      case "enter_otp":
        const verifyData = await verifyOTP(session.mobileNumber, message);
        if (verifyData) {
          session.token = verifyData.token;
          session.custId = verifyData.custId;
          await sendMessage(mobile, "OTP verified successfully! Please enter your Pincode.");
          session.step = "enter_pincode";
        } else {
          await sendMessage(mobile, "Invalid OTP. Please try again.");
        }
        break;

      case "enter_pincode":
        if (/^\d{6}$/.test(message)) {
          session.pincode = message;
          const serviceCheck = await checkServiceAvailability(session.pincode, session.token);
          if (serviceCheck.success) {
            await sendMessage(mobile, "Please fill out your Loan Application Form in the format:\n*Name, PAN, DOB (YYYY-MM-DD), Monthly Income, Employment Type, Salary Mode*");
            session.step = "loan_application_form";
          } else {
            await sendMessage(mobile, "Sorry, we currently do not provide services in your area.");
            resetSession(mobile);
          }
        } else {
          await sendMessage(mobile, "Invalid Pincode. Please enter a valid 6-digit Pincode.");
        }
        break;

      case "loan_application_form":
        const details = message.split(",");
        if (details.length === 6) {
          session.loanDetails = {
            name: details[0].trim(),
            pan: details[1].trim(),
            dob: details[2].trim(),
            income: details[3].trim(),
            employment: details[4].trim(),
            salaryMode: details[5].trim(),
            pincode: session.pincode,
          };
          await sendMessage(mobile, `Your details:\nName: ${session.loanDetails.name}\nPAN: ${session.loanDetails.pan}\nDOB: ${session.loanDetails.dob}\nIncome: ${session.loanDetails.income}\nEmployment: ${session.loanDetails.employment}\nSalary Mode: ${session.loanDetails.salaryMode}\n\nConfirm to proceed by replying 'Yes' or 'No'.`);
          session.step = "confirm_details";
        } else {
          await sendMessage(mobile, "Incomplete details. Please send in the format: Name, PAN, DOB, Monthly Income, Employment Type, Salary Mode.");
        }
        break;

      case "confirm_details":
        if (message.toLowerCase() === "yes") {
          const leadResponse = await createLead(session.loanDetails, session.token, session.custId);
          if (leadResponse.success) {
            session.leadId = leadResponse.data.leadId;
            await sendMessage(mobile, "Your loan application has been submitted successfully. How would you like to proceed?", [
              { text: "Online" },
              { text: "Offline" },
            ]);
            session.step = "select_processing_mode";
          } else {
            await sendMessage(mobile, "Failed to create loan lead. Please try again later.");
            resetSession(mobile);
          }
        } else {
          await sendMessage(mobile, "Loan application canceled. You can restart by typing 'Hi'.");
          resetSession(mobile);
        }
        break;

      default:
        await sendMessage(mobile, "Invalid input. Please type 'Hi' to restart the process.");
    }

    sessions[mobile] = session;
    res.status(200).json({ status: "success" });
  } catch (error) {
    console.error("Error processing message:", error);
    res.status(500).json({ status: "error", message: "Server error" });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Webhook server is running on port ${PORT}`));
