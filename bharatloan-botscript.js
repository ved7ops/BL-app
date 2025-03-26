// BharatLoan Automated WhatsApp Loan Application Flow Script - Part 1 of 3

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const FormData = require("form-data");
const app = express();
app.use(bodyParser.json());

const sessions = {}; 
const API_BASE_URL = "https://preprod-node.bharatloanfintech.com/journey-service/api/v1/";
const API_HEADERS = {
  "Content-Type": "application/json"
};

async function sendMessage(mobile, text, quickReplies = []) {
  const payload = { mobile, text, quickReplies };
  return axios.post("https://bl-app.onrender.com/send-message", payload);
}

async function triggerLoanDisbursalAPI(accountDetails, token) {
  try {
    const response = await axios.post(`${API_BASE_URL}disburse-loan`, accountDetails, { headers: { Authorization: `Bearer ${token}` } });
    return response.data;
  } catch (error) {
    console.error("Error during loan disbursal:", error);
    return { success: false };
  }
}

async function checkLoanStatus(mobileNumber, token) {
  try {
    const response = await axios.post(`${API_BASE_URL}loan-status`, { mobileNumber }, { headers: { Authorization: `Bearer ${token}` } });
    return response.data;
  } catch (error) {
    console.error("Error checking loan status:", error);
    return null;
  }
}

async function uploadSelfie(custId, leadId, document) {
  try {
    const formData = new FormData();
    formData.append("custId", custId);
    formData.append("leadId", leadId);
    formData.append("selfie", document);
    const response = await axios.post(`${API_BASE_URL}upload-selfie`, formData, {
      headers: { ...API_HEADERS, "Content-Type": "multipart/form-data" },
    });
    return response.data;
  } catch (error) {
    console.error("Error uploading selfie:", error);
    return { success: false };
  }
}

async function uploadUtilityBill(custId, leadId, document) {
  try {
    const formData = new FormData();
    formData.append("custId", custId);
    formData.append("leadId", leadId);
    formData.append("docType", "UTILITY BILL");
    formData.append("utilityBill", document);
    const response = await axios.post(`${API_BASE_URL}upload-residence-docs`, formData, {
      headers: { ...API_HEADERS, "Content-Type": "multipart/form-data" },
    });
    return response.data;
  } catch (error) {
    console.error("Error uploading utility bill:", error);
    return { success: false };
  }
}

async function uploadSalarySlip(custId, leadId, document, password) {
  try {
    const formData = new FormData();
    formData.append("custId", custId);
    formData.append("leadId", leadId);
    formData.append("salarySlip", document);
    if (password) formData.append("password", password);

    const response = await axios.post(`${API_BASE_URL}upload-salary-slip`, formData, {
      headers: { ...API_HEADERS, "Content-Type": "multipart/form-data" },
    });
    return response.data;
  } catch (error) {
    console.error("Error uploading salary slip:", error);
    return { success: false };
  }
}

app.post("/webhook", async (req, res) => {
  const { mobile, message } = req.body;
  let session = sessions[mobile] || { step: "start" };

  try {
    switch (session.step) {
      case "select_processing_mode":
        if (message === "Online") {
          await sendMessage(mobile, "Please create your account using the following link: [Account Creation Link]");
          await sendMessage(mobile, "Reply 'Done' once you have created your account.");
          session.step = "account_created_confirmation";
        } else if (message === "Offline") {
          await sendMessage(mobile, "Is your salary slip password-protected?", [{ text: "Yes" }, { text: "No" }]);
          session.step = "salary_slip_password_check";
        }
        break;

      case "account_created_confirmation":
        if (message.toLowerCase() === "done") {
          await sendMessage(mobile, "Great! We are now processing your loan offer...");
          session.step = "loan_offer";
        } else {
          await sendMessage(mobile, "Please reply 'Done' after you have created your account.");
        }
        break;

      case "salary_slip_password_check":
        session.isPasswordProtected = message === "Yes";
        await sendMessage(mobile, "Please upload your Salary Slip.");
        session.step = "upload_salary_slip";
        break;

      case "upload_salary_slip":
        if (message.document) {
          const salarySlipUploadResponse = await uploadSalarySlip(session.custId, session.leadId, message.document, session.isPasswordProtected ? message.password : "");
          if (salarySlipUploadResponse.success) {
            await sendMessage(mobile, "Salary Slip uploaded successfully! Now, please upload your Bank Statement.");
            session.step = "upload_bank_statement";
          } else {
            await sendMessage(mobile, "Failed to upload salary slip. Please try again.");
          }
        } else {
          await sendMessage(mobile, "Please upload a valid Salary Slip.");
        }
        break;

case "upload_bank_statement":
        if (message.document) {
          const bankStatementUploadResponse = await uploadBankStatement(session.custId, session.leadId, message.document);
          if (bankStatementUploadResponse.success) {
            await sendMessage(mobile, "Your documents have been uploaded successfully. Processing...");
            session.step = "loan_offer";
          } else {
            await sendMessage(mobile, "Failed to upload bank statement. Please try again.");
          }
        } else {
          await sendMessage(mobile, "Please upload a valid Bank Statement.");
        }
        break;

      case "loan_offer":
        const loanOfferResponse = await triggerLoanOfferAPI({ leadId: session.leadId }, session.token);
        if (loanOfferResponse.success) {
          const { max_loan_amount, interest_rate, emi } = loanOfferResponse.data;
          await sendMessage(mobile, `Congratulations! Your loan offer:\n\n✅ Loan Amount: ₹${max_loan_amount}\n✅ Interest Rate: ${interest_rate}%\n✅ EMI: ₹${emi}\n\nDo you accept this offer?`, [
            { text: "Accept" },
            { text: "Decline" }
          ]);
          session.step = "accept_loan_offer";
        } else {
          await sendMessage(mobile, "Unfortunately, we couldn't generate a loan offer for you. Please try again later.");
          delete sessions[mobile];
        }
        break;

      case "accept_loan_offer":
        if (message === "Accept") {
          await sendMessage(mobile, "Great! Let's proceed to the KYC verification.");
          await sendMessage(mobile, "Please complete your KYC using the following link: [KYC Verification Link]");
          session.step = "kyc_verification";
        } else {
          await sendMessage(mobile, "Loan application declined. If you change your mind, restart the process by typing 'Hi'.");
          delete sessions[mobile];
        }
        break;

      case "kyc_verification":
        await sendMessage(mobile, "KYC process in progress. Please upload your Selfie.");
        session.step = "upload_selfie";
        break;

      case "upload_selfie":
        if (message.document) {
          const selfieUploadResponse = await uploadSelfie(session.custId, session.leadId, message.document);
          if (selfieUploadResponse.success) {
            await sendMessage(mobile, "Selfie uploaded successfully! Now, please upload your Utility Bill.");
            session.step = "upload_utility_bill";
          } else {
            await sendMessage(mobile, "Failed to upload selfie. Please try again.");
          }
        } else {
          await sendMessage(mobile, "Please upload a valid Selfie.");
        }
        break;

      case "upload_utility_bill":
        if (message.document) {
          const utilityBillUploadResponse = await uploadUtilityBill(session.custId, session.leadId, message.document);
          if (utilityBillUploadResponse.success) {
            await sendMessage(mobile, "Utility Bill uploaded successfully! Your KYC is being verified...");
            const kycStatus = await triggerKYCVerificationAPI(session.mobileNumber);
            if (kycStatus.verified) {
              await sendMessage(mobile, "KYC Verified! Please provide your disbursal account details.");
              session.step = "enter_disbursal_account";
            } else {
              await sendMessage(mobile, "KYC verification failed. Please try again or contact support.");
              delete sessions[mobile];
            }
          } else {
            await sendMessage(mobile, "Failed to upload utility bill. Please try again.");
          }
        } else {
          await sendMessage(mobile, "Please upload a valid Utility Bill.");
        }
        break;

      case "enter_disbursal_account":
        await sendMessage(mobile, "Please enter your account details in the format:\n*Beneficiary Name, Account Number, IFSC Code*");
        session.step = "confirm_disbursal_account";
        break;

      case "confirm_disbursal_account":
        const accountDetails = message.split(",");
        if (accountDetails.length < 3) {
          await sendMessage(mobile, "Incomplete account details. Please send in the format: Beneficiary Name, Account Number, IFSC Code.");
        } else {
          session.accountDetails = {
            beneficiary: accountDetails[0].trim(),
            accountNumber: accountDetails[1].trim(),
            ifsc: accountDetails[2].trim()
          };
          await sendMessage(mobile, "Your disbursal account details have been recorded. We will now proceed with loan disbursal.");
          session.step = "loan_disbursal";
        }
        break;


    // BharatLoan Automated WhatsApp Loan Application Flow Script

// Fixing duplicate parameters and cleaning the createLead function

      case "loan_disbursal":
        const disbursalResponse = await triggerLoanDisbursalAPI(session.accountDetails, session.token);
        if (disbursalResponse.success) {
          await sendMessage(mobile, "🎉 Congratulations! Your loan has been successfully disbursed to your account.");
        } else {
          await sendMessage(mobile, "Loan disbursal failed. Please check your account details and try again.");
        }
        delete sessions[mobile];
        break;

      case "check_loan_status":
        const loanStatus = await checkLoanStatus(session.mobileNumber, session.token);
        if (loanStatus) {
          await sendMessage(mobile, `Your loan status:\n\n✅ Status: ${loanStatus.status}\n✅ Disbursed Amount: ₹${loanStatus.amount}\n✅ Remaining EMI: ₹${loanStatus.emi}`);
        } else {
          await sendMessage(mobile, "Unable to fetch your loan status. Please try again later.");
        }
        break;

      default:
        await sendMessage(mobile, "Invalid input. Please type 'Hi' to restart the process.");
    }

    sessions[mobile] = session;
    res.status(200).json({ status: "success" });
  } catch (error) {
    console.error("Error processing message:", error);
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
});


// Helper Functions
async function sendOTP(mobile) {
  try {
    const response = await axios.post(`${API_BASE_URL}customer-send-otp`, { mobile }, { headers: API_HEADERS });
    return response.data;
  } catch (error) {
    console.error("Error sending OTP:", error.response?.data || error.message);
    return { success: false };
  }
}

async function verifyOTP(mobile, otp) {
  try {
    const response = await axios.post(`${API_BASE_URL}customer-verify-otp`, { mobile, otp }, { headers: API_HEADERS });
    return response.data.success ? response.data.data : null;
  } catch (error) {
    console.error("Error verifying OTP:", error.response?.data || error.message);
    return null;
  }
}

async function checkServiceAvailability(pincode, token) {
  try {
    const headers = { ...API_HEADERS, "Authorization": `Bearer ${token}` };
    const response = await axios.get(`${API_BASE_URL}get-pincode-details?pincode=${pincode}`, { headers });
    return response.data;
  } catch (error) {
    console.error("Error checking pincode:", error.response?.data || error.message);
    return { success: false };
  }
}

async function createLead(loanDetails, token, custId) {
  try {
    const headers = { "Authorization": `Bearer ${token}` };
    const formData = new FormData();
    formData.append("custId", custId);
    formData.append("employementType", "1");
    formData.append("pincode", loanDetails.pincode);
    formData.append("pancard", loanDetails.pan);
    formData.append("personalEmail", loanDetails.email);
    formData.append("stateId", "13"); // Example stateId
    formData.append("cityId", "3"); // Example cityId
    formData.append("stateName", "Haryana");
    formData.append("cityName", "Gurgaon");
    formData.append("mobile", loanDetails.mobile);
    formData.append("requestSource", "CHATBOAT");
    formData.append("salaryAmt", loanDetails.income);
    formData.append("dob", loanDetails.dob);
    formData.append("salaryMode", loanDetails.salaryMode);

    const response = await axios.post("https://preprod-node.bharatloanfintech.com/journey-service/api/v1/journey-create-leads", formData, {
      headers: { ...headers, ...formData.getHeaders() },
    });
    return response.data;
  } catch (error) {
    console.error("Error creating lead:", error.response?.data || error.message);
    return { success: false };
  }
}

async function uploadBankStatement(custId, leadId, document) {
  try {
    const formData = new FormData();
    formData.append("custId", custId);
    formData.append("leadId", leadId);
    formData.append("bankStatement", document);

    const response = await axios.post(`${API_BASE_URL}upload-bank-statement`, formData, {
      headers: { ...API_HEADERS, "Content-Type": "multipart/form-data" },
    });
    return response.data;
  } catch (error) {
    console.error("Error uploading bank statement:", error);
    return { success: false };
  }
}

async function triggerLoanOfferAPI(loanDetails, token) {
  try {
    const headers = { ...API_HEADERS, "Authorization": `Bearer ${token}` };
    const response = await axios.post(`${API_BASE_URL}journey-generate-loan-offer`, loanDetails, { headers });
    return response.data;
  } catch (error) {
    console.error("Error generating loan offer:", error.response?.data || error.message);
    return { success: false };
  }
}

async function triggerKYCVerificationAPI(mobileNumber) {
  try {
    const response = await axios.post(`${API_BASE_URL}kyc-verification`, { mobileNumber }, { headers: API_HEADERS });
    return response.data;
  } catch (error) {
    console.error("Error verifying KYC:", error.response?.data || error.message);
    return { verified: false };
  }
}

async function checkLoanStatus(mobileNumber, token) {
  try {
    const headers = { ...API_HEADERS, "Authorization": `Bearer ${token}` };
    const response = await axios.get(`${API_BASE_URL}loan-status?mobileNumber=${mobileNumber}`, { headers });
    return response.data;
  } catch (error) {
    console.error("Error checking loan status:", error.response?.data || error.message);
    return null;
  }
}

// End of Full Script.



const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
