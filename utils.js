// === utils.js ===
const fs = require("fs");
const path = require("path");
const colors = require("colors");
const { URL } = require("url");

const BRAND_NAME = "Coresky"; // Có thể đổi tên thương hiệu ở đây nếu muốn
let proxyListInternal = [];
let proxyIndexInternal = 0;

function extractIpFromProxy(proxyUrl) {
  if (!proxyUrl) return null;
  try {
    const urlObject = new URL(proxyUrl);
    return urlObject.hostname;
  } catch (e) {
    const ipRegex = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/;
    const ipMatch = proxyUrl.match(ipRegex);
    if (ipMatch && ipMatch[1]) return ipMatch[1];
    const hostMatch = proxyUrl.match(/^(?:https?:\/\/)?([^:\/]+)/);
    return hostMatch ? hostMatch[1] : proxyUrl;
  }
}

function logAction(
  accountIndex,
  accountWallet,
  proxyFullUrl,
  message,
  status = "info",
  txLink = null,
  isWorkerDebugLog = false,
  globalDebugFlag = false
) {
  if (isWorkerDebugLog && !globalDebugFlag) {
    return;
  }

  const now = new Date();
  let hours = now.getHours();
  const minutes = now.getMinutes().toString().padStart(2, "0");
  const seconds = now.getSeconds().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;
  const timestamp = `[${hours}:${minutes}:${seconds} ${ampm}]`;

  const proxyIp = extractIpFromProxy(proxyFullUrl);
  const indexStr =
    accountIndex !== null && accountIndex !== undefined
      ? `[${accountIndex + 1}]`
      : "";
  const walletStr = accountWallet ? `[${accountWallet}]` : "";
  const proxyStr = proxyIp ? `[${proxyIp}]` : "";

  let fullMessage = `[${BRAND_NAME}]${timestamp}${indexStr}${walletStr}${proxyStr} ${message}`;
  if (txLink) {
    fullMessage += `: ${txLink}`;
  }

  switch (status) {
    case "success":
      console.log(fullMessage.green);
      break;
    case "error":
      console.log(fullMessage.red);
      break;
    case "warn":
      console.log(fullMessage.yellow);
      break;
    case "info":
      console.log(fullMessage.blue);
      break;
    default:
      console.log(fullMessage.cyan);
      break;
  }
}

function loadProxies(DEBUG_FLAG) {
  proxyListInternal = [];
  proxyIndexInternal = 0;
  const proxyFilePath = path.join(__dirname, "proxy.txt");
  if (fs.existsSync(proxyFilePath)) {
    const content = fs.readFileSync(proxyFilePath, "utf8");
    proxyListInternal = content
      .split("\n")
      .map((l) => l.trim())
      .filter(
        (l) =>
          l &&
          !l.toLowerCase().includes("local") &&
          (l.startsWith("http://") || l.startsWith("https://"))
      );
    logAction(
      null,
      null,
      null,
      `Đã tải ${proxyListInternal.length} proxy từ proxy.txt.`,
      "info",
      null,
      false,
      DEBUG_FLAG
    );
    if (proxyListInternal.length === 0)
      logAction(
        null,
        null,
        null,
        "CẢNH BÁO: Danh sách proxy rỗng hoặc không hợp lệ. Script sẽ chạy không có proxy.",
        "warn",
        null,
        false,
        DEBUG_FLAG
      );
  } else {
    logAction(
      null,
      null,
      null,
      "Không tìm thấy file proxy.txt. Script sẽ chạy không có proxy.",
      "warn",
      null,
      false,
      DEBUG_FLAG
    );
  }
}

function getNextProxyURL() {
  if (proxyListInternal.length === 0) return null;
  const proxy =
    proxyListInternal[proxyIndexInternal % proxyListInternal.length];
  proxyIndexInternal++;
  return proxy;
}

function generateAccountJsonFromTxtFiles(refForNewAccounts, DEBUG_FLAG) {
  const privateKeyFile = path.join(__dirname, "private_key.txt"); // Đã đổi tên file
  const addressFile = path.join(__dirname, "address.txt"); // Đã đổi tên file
  const outputJsonFile = path.join(__dirname, "account.json");

  let privateKeys = [];
  let addresses = [];

  if (fs.existsSync(privateKeyFile)) {
    privateKeys = fs
      .readFileSync(privateKeyFile, "utf8")
      .split(/\r?\n/)
      .map((pk) => pk.trim())
      .filter((pk) => pk);
  } else {
    logAction(
      null,
      null,
      null,
      `File ${privateKeyFile} không tồn tại.`,
      "warn",
      null,
      false,
      DEBUG_FLAG
    );
    return false;
  }

  if (fs.existsSync(addressFile)) {
    addresses = fs
      .readFileSync(addressFile, "utf8")
      .split(/\r?\n/)
      .map((addr) => addr.trim())
      .filter((addr) => addr);
  } else {
    logAction(
      null,
      null,
      null,
      `File ${addressFile} không tồn tại.`,
      "warn",
      null,
      false,
      DEBUG_FLAG
    );
    return false;
  }

  if (privateKeys.length === 0 || addresses.length === 0) {
    logAction(
      null,
      null,
      null,
      `File ${privateKeyFile} hoặc ${addressFile} rỗng.`,
      "warn",
      null,
      false,
      DEBUG_FLAG
    );
    return false;
  }

  const numAccountsToGenerate = Math.min(privateKeys.length, addresses.length);
  if (numAccountsToGenerate === 0) {
    logAction(
      null,
      null,
      null,
      "Không có cặp private key/address nào hợp lệ.",
      "warn",
      null,
      false,
      DEBUG_FLAG
    );
    return false;
  }

  const accountsData = [];
  for (let i = 0; i < numAccountsToGenerate; i++) {
    if (!privateKeys[i].startsWith("0x") || privateKeys[i].length !== 66) {
      logAction(
        null,
        null,
        null,
        `Private key không hợp lệ ở dòng ${
          i + 1
        } file ${privateKeyFile}: Bỏ qua.`,
        "warn",
        null,
        true,
        DEBUG_FLAG
      );
      continue;
    }
    if (!addresses[i].startsWith("0x") || addresses[i].length !== 42) {
      logAction(
        null,
        null,
        null,
        `Địa chỉ ví không hợp lệ ở dòng ${i + 1} file ${addressFile}: Bỏ qua.`,
        "warn",
        null,
        true,
        DEBUG_FLAG
      );
      continue;
    }
    accountsData.push({
      wallet: addresses[i],
      private_key: privateKeys[i],
      ref: refForNewAccounts || "",
      token: "",
      signature: "",
    });
  }

  if (accountsData.length === 0) {
    logAction(
      null,
      null,
      null,
      "Không tạo được tài khoản nào từ file txt do dữ liệu không hợp lệ.",
      "warn",
      null,
      false,
      DEBUG_FLAG
    );
    return false;
  }

  try {
    fs.writeFileSync(outputJsonFile, JSON.stringify(accountsData, null, 2));
    logAction(
      null,
      null,
      null,
      `Đã tạo/cập nhật '${outputJsonFile}' với ${accountsData.length} tài khoản.`,
      "success",
      null,
      false,
      DEBUG_FLAG
    );
    return true;
  } catch (error) {
    logAction(
      null,
      null,
      null,
      `Lỗi khi ghi vào file '${outputJsonFile}': ${error.message}`,
      "error",
      null,
      false,
      DEBUG_FLAG
    );
    return false;
  }
}

function readAccountsFromJSON(DEBUG_FLAG) {
  const accountJsonPath = path.join(__dirname, "account.json");
  if (fs.existsSync(accountJsonPath)) {
    try {
      const fileContent = fs.readFileSync(accountJsonPath, "utf8");
      if (!fileContent.trim()) {
        logAction(
          null,
          null,
          null,
          "File account.json rỗng.",
          "warn",
          null,
          false,
          DEBUG_FLAG
        );
        return [];
      }
      const accounts = JSON.parse(fileContent);
      if (!Array.isArray(accounts)) {
        logAction(
          null,
          null,
          null,
          "Lỗi: account.json không phải là một JSON array hợp lệ.",
          "error",
          null,
          false,
          DEBUG_FLAG
        );
        return [];
      }
      logAction(
        null,
        null,
        null,
        `Đã đọc ${accounts.length} tài khoản từ account.json.`,
        "info",
        null,
        false,
        DEBUG_FLAG
      );
      return accounts;
    } catch (error) {
      logAction(
        null,
        null,
        null,
        `Lỗi khi đọc hoặc parse file account.json: ${error.message}`,
        "error",
        null,
        false,
        DEBUG_FLAG
      );
      return [];
    }
  }
  logAction(
    null,
    null,
    null,
    "File account.json không tồn tại.",
    "warn",
    null,
    false,
    DEBUG_FLAG
  );
  return [];
}

function updateAccountJSON(accountsToUpdate, DEBUG_FLAG) {
  const accountsArray = Array.isArray(accountsToUpdate)
    ? accountsToUpdate
    : [accountsToUpdate];
  if (accountsArray.length === 0) return;

  const accountJsonPath = path.join(__dirname, "account.json");
  let existingAccounts = readAccountsFromJSON(DEBUG_FLAG);
  if (!Array.isArray(existingAccounts)) {
    logAction(
      null,
      null,
      null,
      "account.json không hợp lệ hoặc không tồn tại khi update, sẽ tạo mới/ghi đè.",
      "warn",
      null,
      false,
      DEBUG_FLAG
    );
    existingAccounts = [];
  }

  accountsArray.forEach((newAccData) => {
    if (!newAccData || !newAccData.wallet) {
      logAction(
        null,
        null,
        null,
        `Dữ liệu tài khoản không hợp lệ để cập nhật: ${JSON.stringify(
          newAccData
        )}`,
        "warn",
        null,
        true,
        DEBUG_FLAG
      );
      return;
    }
    const index = existingAccounts.findIndex(
      (acc) =>
        acc &&
        acc.wallet &&
        acc.wallet.toLowerCase() === newAccData.wallet.toLowerCase()
    );

    const {
      error,
      status,
      memeVotesCastThisRun,
      currentScoreAfterVote,
      ...dataToSave
    } = newAccData;

    if (index === -1) {
      existingAccounts.push(dataToSave);
    } else {
      existingAccounts[index] = { ...existingAccounts[index], ...dataToSave };
    }
  });
  try {
    fs.writeFileSync(
      accountJsonPath,
      JSON.stringify(existingAccounts, null, 2)
    );
    if (DEBUG_FLAG && accountsArray[0] && accountsArray[0].wallet) {
      logAction(
        null,
        null,
        null,
        `Đã cập nhật account.json cho ${accountsArray.length} tài khoản (ví dụ: ${accountsArray[0].wallet}).`,
        "info",
        null,
        true,
        DEBUG_FLAG
      );
    }
  } catch (error) {
    logAction(
      null,
      null,
      null,
      `Lỗi khi ghi vào file account.json: ${error.message}`,
      "error",
      null,
      false,
      DEBUG_FLAG
    );
  }
}

function startCountdown(totalSeconds, DEBUG_FLAG) {
  const hoursForCountdown = parseFloat((totalSeconds / 3600).toFixed(2));
  const displayTime =
    hoursForCountdown >= 0.01
      ? `${hoursForCountdown} giờ`
      : `${totalSeconds} giây`;
  logAction(
    null,
    null,
    null,
    `Bắt đầu đếm ngược ${displayTime} cho lần tiếp theo`,
    "info",
    null,
    false,
    DEBUG_FLAG
  );
  let remainingSeconds = totalSeconds;
  const interval = setInterval(() => {
    remainingSeconds--;
    const hrs = Math.floor(remainingSeconds / 3600)
      .toString()
      .padStart(2, "0");
    const mins = Math.floor((remainingSeconds % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const secs = (remainingSeconds % 60).toString().padStart(2, "0");
    process.stdout.write(
      `\r[${BRAND_NAME}] Đếm ngược: ${hrs}:${mins}:${secs}   `
    );
    if (remainingSeconds <= 0) {
      clearInterval(interval);
      logAction(
        null,
        null,
        null,
        "Đếm ngược kết thúc. Chương trình sẽ chạy lại.",
        "success",
        null,
        false,
        DEBUG_FLAG
      );
      process.exit(0);
    }
  }, 1000);
}

module.exports = {
  BRAND_NAME,
  extractIpFromProxy,
  logAction,
  loadProxies,
  getNextProxyURL,
  generateAccountJsonFromTxtFiles,
  readAccountsFromJSON,
  updateAccountJSON,
  startCountdown,
};
