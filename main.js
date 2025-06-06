// === coresky.js (main.js) ===
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require("worker_threads");

// Import từ utils.js
const {
  logAction,
  loadProxies,
  getNextProxyURL,
  generateAccountJsonFromTxtFiles,
  readAccountsFromJSON,
  updateAccountJSON,
  startCountdown,
} = require("./utils.js");

// Đọc biến môi trường
const numThreads = parseInt(process.env.NUM_THREADS) || 1;
const defaultRefCode = process.env.REF_CODE || "w5yudk";
const delayMinMs =
  (parseInt(process.env.DELAY_BETWEEN_BATCHES_MIN_S) || 5) * 1000;
const delayMaxMs =
  (parseInt(process.env.DELAY_BETWEEN_BATCHES_MAX_S) || 10) * 1000;
const DEBUG = process.env.DEBUG === "true";

// Delay ngẫu nhiên giữa các API calls trong worker
const DELAY_WORKER_API_CALLS_MIN_MS =
  parseInt(process.env.DELAY_WORKER_API_CALLS_MIN_MS) || 1000;
const DELAY_WORKER_API_CALLS_MAX_MS =
  parseInt(process.env.DELAY_WORKER_API_CALLS_MAX_MS) || 3000;

// Retry env vars
const LOGIN_MAX_RETRIES = parseInt(process.env.LOGIN_MAX_RETRIES) || 2;
const VOTE_MAX_RETRIES = parseInt(process.env.VOTE_MAX_RETRIES) || 2;
const RETRY_DELAY_MIN_MS = parseInt(process.env.RETRY_DELAY_MIN_MS) || 4000;
const RETRY_DELAY_MAX_MS = parseInt(process.env.RETRY_DELAY_MAX_MS) || 5000;

const ENABLE_MEME_VOTING = process.env.ENABLE_MEME_VOTING === "true";
const MEME_VOTE_TARGET_PROJECT_ID =
  parseInt(process.env.MEME_VOTE_TARGET_PROJECT_ID) || 0;
const MEME_VOTES_TO_CAST_PER_PROJECT =
  parseInt(process.env.MEME_VOTES_TO_CAST_PER_PROJECT) || 10;
const MEME_MIN_SCORE_TO_ATTEMPT_VOTE =
  parseInt(process.env.MEME_MIN_SCORE_TO_ATTEMPT_VOTE) || 1;
const MEME_VOTE_USE_ALL_AVAILABLE_SCORE =
  process.env.MEME_VOTE_USE_ALL_AVAILABLE_SCORE === "true";

const AUTO_GENERATE_ACCOUNT_JSON_FROM_TXT =
  process.env.AUTO_GENERATE_ACCOUNT_JSON_FROM_TXT === "true";
const RESTART_DELAY_HOURS = parseFloat(process.env.RESTART_DELAY_HOURS) || 24;
const SKIP_IF_ALREADY_CHECKED_IN =
  process.env.SKIP_IF_ALREADY_CHECKED_IN === "true";

if (isMainThread) {
  if (DEBUG) {
    logAction(
      null,
      null,
      null,
      "Chế độ DEBUG đang được bật.",
      "warn",
      null,
      false,
      DEBUG
    );
    logAction(
      null,
      null,
      null,
      `Số luồng: ${numThreads}`,
      "info",
      null,
      false,
      DEBUG
    );
    logAction(
      null,
      null,
      null,
      `Ref code mặc định: ${defaultRefCode}`,
      "info",
      null,
      false,
      DEBUG
    );
    logAction(
      null,
      null,
      null,
      `Thời gian tự khởi động lại bot: ${RESTART_DELAY_HOURS} giờ`,
      "info",
      null,
      false,
      DEBUG
    );
    logAction(
      null,
      null,
      null,
      `Bỏ qua tài khoản đã check-in: ${SKIP_IF_ALREADY_CHECKED_IN}`,
      "info",
      null,
      false,
      DEBUG
    );
    logAction(
      null,
      null,
      null,
      `Tự động tạo account.json: ${AUTO_GENERATE_ACCOUNT_JSON_FROM_TXT}`,
      "info",
      null,
      false,
      DEBUG
    );
    logAction(
      null,
      null,
      null,
      `Delay batches: ${delayMinMs / 1000}s - ${delayMaxMs / 1000}s`,
      "info",
      null,
      false,
      DEBUG
    );
    logAction(
      null,
      null,
      null,
      `Delay API calls (worker): ${DELAY_WORKER_API_CALLS_MIN_MS}ms - ${DELAY_WORKER_API_CALLS_MAX_MS}ms`,
      "info",
      null,
      false,
      DEBUG
    );

    if (ENABLE_MEME_VOTING) {
      logAction(
        null,
        null,
        null,
        "Tính năng Meme Voting: Đã bật",
        "info",
        null,
        false,
        DEBUG
      );
      logAction(
        null,
        null,
        null,
        `  -> ID Project Meme mục tiêu: ${
          MEME_VOTE_TARGET_PROJECT_ID === 0
            ? "Vote cho project đầu tiên trong danh sách"
            : MEME_VOTE_TARGET_PROJECT_ID
        }`,
        "info",
        null,
        false,
        DEBUG
      );
      if (MEME_VOTE_USE_ALL_AVAILABLE_SCORE) {
        logAction(
          null,
          null,
          null,
          `  -> Chế độ Vote tất cả SCORE: Bật`,
          "info",
          null,
          false,
          DEBUG
        );
      } else {
        logAction(
          null,
          null,
          null,
          `  -> Số vote mặc định/project: ${MEME_VOTES_TO_CAST_PER_PROJECT}`,
          "info",
          null,
          false,
          DEBUG
        );
      }
      logAction(
        null,
        null,
        null,
        `  -> Score tối thiểu để vote: ${MEME_MIN_SCORE_TO_ATTEMPT_VOTE}`,
        "info",
        null,
        false,
        DEBUG
      );
    } else {
      logAction(
        null,
        null,
        null,
        "Tính năng Meme Voting: Đã tắt",
        "info",
        null,
        false,
        DEBUG
      );
    }
    logAction(
      null,
      null,
      null,
      `Login Retries (ngắn): ${LOGIN_MAX_RETRIES}, Vote Retries: ${VOTE_MAX_RETRIES}, Retry Delay (ngắn): ${RETRY_DELAY_MIN_MS}ms - ${RETRY_DELAY_MAX_MS}ms`,
      "info",
      null,
      false,
      DEBUG
    );
  }
}

async function runWorkerBatch(accountsToRun, totalThreads) {
  const results = [];
  if (DEBUG)
    logAction(
      null,
      null,
      null,
      `runWorkerBatch: Bắt đầu xử lý ${accountsToRun.length} tài khoản với ${totalThreads} luồng.`,
      "info",
      null,
      true,
      DEBUG
    );

  for (let i = 0; i < accountsToRun.length; i += totalThreads) {
    const batch = accountsToRun.slice(i, i + totalThreads);
    if (DEBUG && batch.length > 0) {
      logAction(
        null,
        null,
        null,
        `runWorkerBatch: Đang xử lý batch từ index ${i} (trong danh sách accountsToRun), kích thước batch: ${batch.length}, account đầu tiên: ${batch[0].wallet}`,
        "info",
        null,
        true,
        DEBUG
      );
    }

    const workerPromises = batch.map((accountData) => {
      const originalAccountIndex = accountData.originalIndexInFullList;
      const proxyURL = getNextProxyURL();

      if (DEBUG) {
        logAction(
          originalAccountIndex,
          accountData.wallet,
          proxyURL,
          `Chuẩn bị khởi chạy worker...`,
          "info",
          null,
          true,
          DEBUG
        );
      }

      return new Promise((resolve) => {
        const worker = new Worker(__filename, {
          workerData: {
            account: accountData,
            originalAccountIndex,
            proxyURL,
            DEBUG,
            // Truyền khoảng delay ngẫu nhiên cho worker
            DELAY_WORKER_API_CALLS_MIN_MS,
            DELAY_WORKER_API_CALLS_MAX_MS,
            ENABLE_MEME_VOTING,
            MEME_VOTE_TARGET_PROJECT_ID,
            MEME_VOTES_TO_CAST_PER_PROJECT,
            MEME_MIN_SCORE_TO_ATTEMPT_VOTE,
            MEME_VOTE_USE_ALL_AVAILABLE_SCORE,
            LOGIN_MAX_RETRIES,
            VOTE_MAX_RETRIES,
            RETRY_DELAY_MIN_MS,
            RETRY_DELAY_MAX_MS,
            SKIP_IF_ALREADY_CHECKED_IN,
          },
        });
        worker.on("message", (message) => {
          resolve(message);
        });
        worker.on("error", (error) => {
          logAction(
            originalAccountIndex,
            accountData.wallet,
            proxyURL,
            `Worker gặp lỗi nghiêm trọng: ${error.message}`,
            "error",
            null,
            false,
            DEBUG
          );
          resolve({
            ...accountData,
            error: `Worker error: ${error.message}`,
            status: "WORKER_CRASHED",
          });
        });
        worker.on("exit", (code) => {
          if (code !== 0) {
            logAction(
              originalAccountIndex,
              accountData.wallet,
              proxyURL,
              `Worker dừng với exit code ${code}`,
              "error",
              null,
              false,
              DEBUG
            );
            resolve({
              ...accountData,
              error: `Worker exited with code ${code}`,
              status: "WORKER_EXITED_NON_ZERO",
            });
          }
        });
      });
    });

    const batchResults = await Promise.allSettled(workerPromises);
    batchResults.forEach((res, indexWithinBatch) => {
      const originalAccountFromBatch = batch[indexWithinBatch];
      if (res.status === "fulfilled" && res.value && res.value.wallet) {
        results.push(res.value);
        updateAccountJSON(res.value, DEBUG);
      } else {
        let errorMessage =
          "Unknown worker processing error or worker did not return valid data.";
        if (res.reason) {
          errorMessage = `Worker failed: ${
            res.reason.message || JSON.stringify(res.reason)
          }`;
        } else if (res.value && res.value.error) {
          errorMessage = `Worker reported error: ${res.value.error}`;
        } else if (res.value && !res.value.wallet) {
          errorMessage = `Worker returned invalid data (missing wallet): ${JSON.stringify(
            res.value
          )}`;
        } else if (res.status !== "fulfilled") {
          errorMessage = `Promise for worker was not fulfilled: ${JSON.stringify(
            res
          )}`;
        }
        if (originalAccountFromBatch && originalAccountFromBatch.wallet) {
          logAction(
            originalAccountFromBatch.originalIndexInFullList,
            originalAccountFromBatch.wallet,
            null,
            `[MainThread] Vấn đề với kết quả worker: ${errorMessage}`,
            "warn",
            null,
            false,
            DEBUG
          );
        } else {
          console.error(
            `[MainThread] Lỗi nghiêm trọng với worker, không có thông tin tài khoản. Details: ${errorMessage}`
              .red
          );
        }
      }
    });
    logAction(
      null,
      null,
      null,
      `Đã xử lý xong batch ${Math.floor(i / totalThreads) + 1} (${
        batch.length
      } account)`,
      "info",
      null,
      false,
      DEBUG
    );

    if (i + totalThreads < accountsToRun.length) {
      const delay =
        Math.floor(Math.random() * (delayMaxMs - delayMinMs + 1)) + delayMinMs;
      logAction(
        null,
        null,
        null,
        `Đang chờ ${delay / 1000} giây trước khi xử lý batch tiếp theo...`,
        "info",
        null,
        false,
        DEBUG
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return results;
}

if (!isMainThread) {
  const {
    HttpsProxyAgent: HttpsProxyAgentWorker,
  } = require("https-proxy-agent");
  const axiosWorker = require("axios");
  const { ethers: ethersWorker } = require("ethers");

  (async () => {
    const {
      account: acc,
      originalAccountIndex,
      proxyURL,
      DEBUG: workerDEBUG,
      DELAY_WORKER_API_CALLS_MIN_MS: workerApiDelayMin,
      DELAY_WORKER_API_CALLS_MAX_MS: workerApiDelayMax,
      ENABLE_MEME_VOTING: workerEnableMemeVoting,
      MEME_VOTE_TARGET_PROJECT_ID: workerMemeTargetId,
      MEME_VOTES_TO_CAST_PER_PROJECT: workerMemeVotesPerProjectConfig,
      MEME_MIN_SCORE_TO_ATTEMPT_VOTE: workerMemeMinScoreToAct,
      MEME_VOTE_USE_ALL_AVAILABLE_SCORE: workerMemeUseAllScore,
      LOGIN_MAX_RETRIES: workerLoginMaxRetries,
      VOTE_MAX_RETRIES: workerVoteMaxRetries,
      RETRY_DELAY_MIN_MS: workerRetryDelayMin,
      RETRY_DELAY_MAX_MS: workerRetryDelayMax,
      SKIP_IF_ALREADY_CHECKED_IN: workerSkipCheckedIn,
    } = workerData;

    const agent = proxyURL ? new HttpsProxyAgentWorker(proxyURL) : null;
    const resultAcc = {
      ...acc,
      token: acc.token || null,
      signature: acc.signature || null,
      memeVotesCastThisRun: 0,
      status: "PENDING",
      error: null,
    };

    let userAgentsArrayLocal;
    try {
      userAgentsArrayLocal = require("./userAgents.js");
      if (
        !Array.isArray(userAgentsArrayLocal) ||
        userAgentsArrayLocal.length === 0
      ) {
        logAction(
          originalAccountIndex,
          acc.wallet,
          proxyURL,
          "LỖI: userAgents.js không chứa mảng User Agent hợp lệ hoặc rỗng. Dừng worker.",
          "error",
          null,
          false,
          workerDEBUG
        );
        resultAcc.error = "userAgents.js is invalid or empty.";
        resultAcc.status = "USER_AGENT_LOAD_ERROR";
        parentPort.postMessage(resultAcc);
        return;
      }
    } catch (e) {
      logAction(
        originalAccountIndex,
        acc.wallet,
        proxyURL,
        `LỖI QUAN TRỌNG: Không thể tải userAgents.js. Dừng worker. Lỗi: ${e.message}`,
        "error",
        null,
        false,
        workerDEBUG
      );
      resultAcc.error = `Failed to load userAgents.js: ${e.message}`;
      resultAcc.status = "USER_AGENT_LOAD_ERROR";
      parentPort.postMessage(resultAcc);
      return;
    }
    const randomUserAgent =
      userAgentsArrayLocal[
        Math.floor(Math.random() * userAgentsArrayLocal.length)
      ];

    logAction(
      originalAccountIndex,
      acc.wallet,
      proxyURL,
      `Bắt đầu xử lý... ${
        workerDEBUG
          ? `(UA: ${randomUserAgent.substring(
              0,
              30
            )}..., VoteAllScore=${workerMemeUseAllScore}, SkipChecked=${workerSkipCheckedIn})`
          : ""
      }`,
      "info",
      null,
      false,
      workerDEBUG
    );

    const defaultCookie = `refCode=${acc.ref}; projectId=0; selectWallet=MetaMask`;
    const tasksCookie =
      "_ga=GA1.1.1348111308.1743131097; selectWallet=MetaMask; _ga_65K8PCKDGS=GS1.1.1743845105.9.1.1743848355.0.0.0";

    if (!acc || typeof acc.wallet !== "string" || acc.wallet.trim() === "") {
      logAction(
        originalAccountIndex,
        acc.wallet || "N/A",
        proxyURL,
        `Lỗi: Địa chỉ ví không hợp lệ hoặc bị thiếu.`,
        "error",
        null,
        false,
        workerDEBUG
      );
      resultAcc.error = "Invalid or missing wallet address in account data.";
      resultAcc.status = "ACCOUNT_DATA_ERROR";
      parentPort.postMessage(resultAcc);
      return;
    }
    const walletMessage = `Welcome to CoreSky!\n\nClick to sign in and accept the CoreSky Terms of Service.\n\nThis request will not trigger a blockchain transaction or cost any gas fees.\n\nYour authentication status will reset after 24 hours.\n\nWallet address:\n\n${acc.wallet}`;

    let walletObj;
    try {
      if (!acc.private_key) throw new Error("Private key is missing.");
      walletObj = new ethersWorker.Wallet(acc.private_key);
    } catch (e) {
      logAction(
        originalAccountIndex,
        acc.wallet,
        proxyURL,
        `Lỗi private key: ${e.message}`,
        "error",
        null,
        false,
        workerDEBUG
      );
      resultAcc.error = `Invalid private key: ${e.message}`;
      resultAcc.status = "PRIVATE_KEY_ERROR";
      parentPort.postMessage(resultAcc);
      return;
    }

    let currentSignature = resultAcc.signature;
    if (!currentSignature) {
      try {
        const delayMs =
          Math.floor(
            Math.random() * (workerApiDelayMax - workerApiDelayMin + 1)
          ) + workerApiDelayMin;
        if (workerDEBUG && delayMs > 0) {
          logAction(
            originalAccountIndex,
            acc.wallet,
            proxyURL,
            `Chờ ${delayMs}ms trước khi tạo signature...`,
            "info",
            null,
            true,
            workerDEBUG
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        if (workerDEBUG)
          logAction(
            originalAccountIndex,
            acc.wallet,
            proxyURL,
            `Message ký: "${walletMessage.substring(0, 100)}..."`,
            "info",
            null,
            true,
            workerDEBUG
          );
        currentSignature = await walletObj.signMessage(walletMessage);
        logAction(
          originalAccountIndex,
          acc.wallet,
          proxyURL,
          `Đã tạo signature mới.`,
          "info",
          null,
          false,
          workerDEBUG
        );
        resultAcc.signature = currentSignature;
      } catch (e) {
        logAction(
          originalAccountIndex,
          acc.wallet,
          proxyURL,
          `Lỗi khi ký message ban đầu: ${e.message}`,
          "error",
          null,
          false,
          workerDEBUG
        );
        resultAcc.error = `Initial signature creation failed: ${e.message}`;
        resultAcc.status = "SIGNATURE_CREATION_FAILED";
        parentPort.postMessage(resultAcc);
        return;
      }
    }

    let currentToken = resultAcc.token;

    async function baseCallLocal(
      endpoint,
      method,
      payload,
      tokenOverride = null,
      customHeaders = {}
    ) {
      let currentCookie = defaultCookie;
      if (endpoint === "/api/taskwall/meme/tasks") {
        currentCookie = tasksCookie;
      }
      const headers = {
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        "content-type": "application/json",
        cookie: customHeaders.cookie || currentCookie,
        hearder_gray_set: "0",
        priority: "u=1, i",
        referer: customHeaders.referer || "https://www.coresky.com/meme",
        "sec-ch-ua":
          '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        token: tokenOverride || currentToken,
        "user-agent": randomUserAgent,
        origin: customHeaders.origin || "https://www.coresky.com",
        ...customHeaders,
      };
      if (method.toUpperCase() === "GET" && !payload)
        delete headers["content-type"];

      logAction(
        originalAccountIndex,
        acc.wallet,
        proxyURL,
        `Gọi API: ${method} ${endpoint}${
          payload ? ` Payload: ${JSON.stringify(payload)}` : ""
        }${headers.token ? ` Token: USED` : " Token: null"}`,
        "info",
        null,
        true,
        workerDEBUG
      );

      const config = {
        method,
        url: "https://www.coresky.com" + endpoint,
        headers: headers,
        httpsAgent: agent,
        timeout: 30000,
      };
      if (method.toUpperCase() !== "GET" && payload) config.data = payload;
      try {
        const res = await axiosWorker(config);
        logAction(
          originalAccountIndex,
          acc.wallet,
          proxyURL,
          `API ${endpoint} response code: ${res.status}, data: ${JSON.stringify(
            res.data
          )}`,
          "info",
          null,
          true,
          workerDEBUG
        );
        return res.data;
      } catch (e) {
        const errStatus = e.response ? e.response.status : 503;
        const errData = e.response ? e.response.data : null;
        const errMessage = e.message;
        return {
          error: true,
          status: errStatus,
          message: errMessage,
          data: errData,
        };
      }
    }

    async function callWithDelayLocal(
      endpoint,
      method,
      payload,
      tokenOverride = null,
      customHeaders = {}
    ) {
      const delayMs =
        Math.floor(
          Math.random() * (workerApiDelayMax - workerApiDelayMin + 1)
        ) + workerApiDelayMin;
      if (delayMs > 0) {
        logAction(
          originalAccountIndex,
          acc.wallet,
          proxyURL,
          `Chờ ${delayMs}ms trước khi gọi ${endpoint}...`,
          "info",
          null,
          true,
          workerDEBUG
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return baseCallLocal(
        endpoint,
        method,
        payload,
        tokenOverride,
        customHeaders
      );
    }

    if (workerDEBUG)
      logAction(
        originalAccountIndex,
        acc.wallet,
        proxyURL,
        "Bắt đầu chuỗi API khởi tạo...",
        "info",
        null,
        true,
        workerDEBUG
      );
    await callWithDelayLocal("/api/user/config", "POST", {});
    await callWithDelayLocal("/api/config/ip", "GET");
    await callWithDelayLocal("/api/activity/message/window", "GET");
    await callWithDelayLocal("/api/config/sys", "POST", {});
    await callWithDelayLocal("/api/config/chains", "GET");
    await callWithDelayLocal("/api/config/paytokens", "POST", {});
    await callWithDelayLocal("/api/config/query", "POST", { chainId: "137" });

    let loginSuccessful = false;
    let loginAttempts = 0;
    const maxLoginAttemptsTotal = 1 + workerLoginMaxRetries;
    let loginRes;
    let lastLoginErrorMsg = `Max attempts reached for login.`;

    while (!loginSuccessful && loginAttempts < maxLoginAttemptsTotal) {
      loginAttempts++;
      let currentAttemptFullErrorMsg = "";

      if (loginAttempts > 1) {
        logAction(
          originalAccountIndex,
          acc.wallet,
          proxyURL,
          `Login attempt ${loginAttempts}/${maxLoginAttemptsTotal}...`,
          "warn",
          null,
          false,
          workerDEBUG
        );
        const currentRetryDelay =
          Math.floor(
            Math.random() * (workerRetryDelayMax - workerRetryDelayMin + 1)
          ) + workerRetryDelayMin;
        if (currentRetryDelay > 0) {
          if (workerDEBUG)
            logAction(
              originalAccountIndex,
              acc.wallet,
              proxyURL,
              `Chờ ${currentRetryDelay / 1000}s...`,
              "info",
              null,
              true,
              workerDEBUG
            );
          await new Promise((resolve) =>
            setTimeout(resolve, currentRetryDelay)
          );
        }
      }

      loginRes = await callWithDelayLocal("/api/user/login", "POST", {
        // Đã có delay trong callWithDelayLocal
        address: acc.wallet,
        projectId: "0",
        refCode: acc.ref,
        signature: currentSignature,
      });

      if (
        !loginRes.error &&
        loginRes.code === 200 &&
        loginRes.debug &&
        loginRes.debug.token
      ) {
        currentToken = loginRes.debug.token;
        loginSuccessful = true;
        logAction(
          originalAccountIndex,
          acc.wallet,
          proxyURL,
          `Đăng nhập thành công (Lần thử ${loginAttempts}).`,
          "success",
          null,
          false,
          workerDEBUG
        );
      } else {
        currentAttemptFullErrorMsg = `Code: ${
          loginRes.status || loginRes.code || "N/A"
        }, Msg: ${
          loginRes.message ||
          (loginRes.data
            ? JSON.stringify(loginRes.data)
            : "Login attempt failed")
        }`;
        logAction(
          originalAccountIndex,
          acc.wallet,
          proxyURL,
          `Login attempt ${loginAttempts} thất bại. ${currentAttemptFullErrorMsg}`,
          "warn",
          null,
          false,
          workerDEBUG
        );

        const isSignError = (loginRes.message || "")
          .toUpperCase()
          .includes("SIGN_IS_ERROR");
        const isIPError = (loginRes.message || "")
          .toUpperCase()
          .includes("IP REQUEST EXCEEDED LIMIT");
        const isProxyAuthError = loginRes.status === 407;
        const isRetryableHttpError =
          loginRes.status === 500 ||
          loginRes.status === 502 ||
          loginRes.status === 503 ||
          loginRes.status === 504 ||
          (loginRes.status >= 420 && loginRes.status <= 429);
        const isRetryableMessage =
          loginRes.message &&
          loginRes.message.toLowerCase().includes("please try again later");

        const isPotentiallyRetryable =
          loginRes.error ||
          isRetryableHttpError ||
          isRetryableMessage ||
          isSignError ||
          isIPError;

        if (isProxyAuthError) {
          logAction(
            originalAccountIndex,
            acc.wallet,
            proxyURL,
            `Lỗi Proxy Authentication (407). Dừng thử lại login cho proxy này.`,
            "error",
            null,
            false,
            workerDEBUG
          );
          lastLoginErrorMsg = currentAttemptFullErrorMsg;
          break;
        }

        if (isPotentiallyRetryable && loginAttempts < maxLoginAttemptsTotal) {
          if (isSignError)
            logAction(
              originalAccountIndex,
              acc.wallet,
              proxyURL,
              `Lỗi signature, thử tạo lại signature...`,
              "warn",
              null,
              false,
              workerDEBUG
            );
          else
            logAction(
              originalAccountIndex,
              acc.wallet,
              proxyURL,
              `Lỗi (${currentAttemptFullErrorMsg}), tạo lại signature và thử lại...`,
              "warn",
              null,
              false,
              workerDEBUG
            );
          try {
            const delayMs =
              Math.floor(
                Math.random() * (workerApiDelayMax - workerApiDelayMin + 1)
              ) + workerApiDelayMin;
            if (workerDEBUG && delayMs > 0)
              await new Promise((resolve) => setTimeout(resolve, delayMs));
            currentSignature = await walletObj.signMessage(walletMessage);
            logAction(
              originalAccountIndex,
              acc.wallet,
              proxyURL,
              `Signature mới đã được tạo.`,
              "info",
              null,
              false,
              workerDEBUG
            );
            resultAcc.signature = currentSignature;
          } catch (e) {
            currentAttemptFullErrorMsg = `Signature re-creation failed: ${e.message}`;
            logAction(
              originalAccountIndex,
              acc.wallet,
              proxyURL,
              `Lỗi khi tạo lại signature: ${e.message}`,
              "error",
              null,
              false,
              workerDEBUG
            );
            lastLoginErrorMsg = currentAttemptFullErrorMsg;
            break;
          }
        }
        lastLoginErrorMsg = currentAttemptFullErrorMsg;
      }
    }

    resultAcc.token = currentToken;

    if (!loginSuccessful) {
      logAction(
        originalAccountIndex,
        acc.wallet,
        proxyURL,
        `Đăng nhập KHÔNG thành công sau ${loginAttempts} lần thử. Lỗi cuối: ${lastLoginErrorMsg}`,
        "error",
        null,
        false,
        workerDEBUG
      );
      resultAcc.error = `Login failed: ${lastLoginErrorMsg}`;
      resultAcc.status = "LOGIN_FAILED";
      parentPort.postMessage(resultAcc);
      return;
    } else {
      resultAcc.status = "LOGIN_SUCCESS";
      resultAcc.error = null;
    }

    // --- DAILY CHECK-IN ---
    // ... (Giữ nguyên logic check-in, đảm bảo dùng logAction và callWithDelayLocal) ...
    let dailyCheckinAlreadyDone = false;
    const tasksApiHeaders = {
      cookie: tasksCookie,
      referer: "https://www.coresky.com/tasks-rewards",
    };
    const tasksApiResponse = await callWithDelayLocal(
      "/api/taskwall/meme/tasks",
      "GET",
      null,
      currentToken,
      tasksApiHeaders
    );
    if (
      !tasksApiResponse.error &&
      tasksApiResponse.code === 200 &&
      tasksApiResponse.debug &&
      Array.isArray(tasksApiResponse.debug)
    ) {
      const dailyCheckinTask = tasksApiResponse.debug.find((t) => t.id === 1);
      if (dailyCheckinTask) {
        if (dailyCheckinTask.taskStatus === 0) {
          logAction(
            originalAccountIndex,
            acc.wallet,
            proxyURL,
            `Thực hiện Check-in daily...`,
            "info",
            null,
            false,
            workerDEBUG
          );
          const signCheckinResponse = await callWithDelayLocal(
            "/api/taskwall/meme/sign",
            "POST",
            {},
            currentToken
          );
          if (!signCheckinResponse.error && signCheckinResponse.code === 200) {
            logAction(
              originalAccountIndex,
              acc.wallet,
              proxyURL,
              `Check-in daily THÀNH CÔNG.`,
              "success",
              null,
              false,
              workerDEBUG
            );
            resultAcc.dailyCheckinStatus = "CHECKED_IN_NOW";
          } else {
            logAction(
              originalAccountIndex,
              acc.wallet,
              proxyURL,
              `Lỗi khi Check-in daily. Code: ${
                signCheckinResponse.status || signCheckinResponse.code
              }, Msg: ${
                signCheckinResponse.message ||
                JSON.stringify(signCheckinResponse.data)
              }`,
              "error",
              null,
              false,
              workerDEBUG
            );
            resultAcc.dailyCheckinStatus = "CHECKIN_FAILED";
          }
        } else {
          dailyCheckinAlreadyDone = true;
          resultAcc.dailyCheckinStatus = `ALREADY_CHECKED_IN (Status: ${dailyCheckinTask.taskStatus})`;
          logAction(
            originalAccountIndex,
            acc.wallet,
            proxyURL,
            `Đã check-in daily từ trước (status: ${dailyCheckinTask.taskStatus}).`,
            "info",
            null,
            false,
            workerDEBUG
          );
        }
      } else {
        logAction(
          originalAccountIndex,
          acc.wallet,
          proxyURL,
          `Không tìm thấy task Daily Check-in (id:1).`,
          "warn",
          null,
          false,
          workerDEBUG
        );
        resultAcc.dailyCheckinStatus = "TASK_NOT_FOUND";
      }
    } else {
      logAction(
        originalAccountIndex,
        acc.wallet,
        proxyURL,
        `Không lấy được tasks để check-in. Lỗi: ${
          tasksApiResponse.message || JSON.stringify(tasksApiResponse.data)
        }`,
        "warn",
        null,
        false,
        workerDEBUG
      );
      resultAcc.dailyCheckinStatus = "FETCH_TASKS_FAILED";
    }

    if (workerSkipCheckedIn && dailyCheckinAlreadyDone) {
      logAction(
        originalAccountIndex,
        acc.wallet,
        proxyURL,
        `Tài khoản đã check-in, bỏ qua các tác vụ còn lại theo cấu hình.`,
        "info",
        null,
        false,
        workerDEBUG
      );
      resultAcc.status = "SKIPPED_ALREADY_CHECKED_IN";
      parentPort.postMessage(resultAcc);
      return;
    }

    // --- MEME VOTING FEATURE ---
    if (workerEnableMemeVoting) {
      if (workerDEBUG)
        logAction(
          originalAccountIndex,
          acc.wallet,
          proxyURL,
          "Bắt đầu xử lý Meme Voting.",
          "info",
          null,
          true,
          workerDEBUG
        );

      let currentScore = 0;
      const userTokenInfo = await callWithDelayLocal(
        "/api/user/token",
        "POST",
        {},
        currentToken,
        { isInitialInfoFetch: true }
      );
      if (
        !userTokenInfo.error &&
        userTokenInfo.code === 200 &&
        userTokenInfo.debug &&
        typeof userTokenInfo.debug.score !== "undefined"
      ) {
        currentScore = parseInt(parseFloat(userTokenInfo.debug.score)) || 0;
        logAction(
          originalAccountIndex,
          acc.wallet,
          proxyURL,
          `Điểm (score) hiện tại có thể vote: ${currentScore}`,
          "info",
          null,
          false,
          workerDEBUG
        );
      } else {
        const scoreErrMsg =
          userTokenInfo.message ||
          (userTokenInfo.data
            ? JSON.stringify(userTokenInfo.data)
            : "Không rõ lỗi");
        logAction(
          originalAccountIndex,
          acc.wallet,
          proxyURL,
          `Không lấy được thông tin score. Lỗi: ${scoreErrMsg}. Bỏ qua voting.`,
          "warn",
          null,
          false,
          workerDEBUG
        );
        resultAcc.error =
          (resultAcc.error ? resultAcc.error + "; " : "") +
          `Meme voting: Failed to fetch user score: ${scoreErrMsg}`;
        resultAcc.status = "FETCH_SCORE_FAILED";
      }

      if (
        resultAcc.status !== "FETCH_SCORE_FAILED" &&
        currentScore >= workerMemeMinScoreToAct
      ) {
        let projects = [];
        let projectFetchSuccess = false;
        let projectFetchAttempts = 0;
        const maxProjectFetchRetries = 1 + workerVoteMaxRetries;
        let lastProjectFetchErrorMsg = "Không lấy được danh sách project meme.";

        while (
          !projectFetchSuccess &&
          projectFetchAttempts < maxProjectFetchRetries
        ) {
          projectFetchAttempts++;
          if (projectFetchAttempts > 1) {
            logAction(
              originalAccountIndex,
              acc.wallet,
              proxyURL,
              `Thử lại lấy danh sách project meme lần ${projectFetchAttempts}/${maxProjectFetchRetries}...`,
              "warn",
              null,
              false,
              workerDEBUG
            );
            const currentProjectRetryDelay =
              Math.floor(
                Math.random() * (workerRetryDelayMax - workerRetryDelayMin + 1)
              ) + workerRetryDelayMin;
            if (currentProjectRetryDelay > 0)
              await new Promise((resolve) =>
                setTimeout(resolve, currentProjectRetryDelay)
              );
          }

          const projectListParams = `?sortBy=&search=&tag=&page=1&limit=9&tradeFlag=-1`;
          const memeProjectsResponse = await callWithDelayLocal(
            `/api/meme/project/list${projectListParams}`,
            "GET",
            null,
            currentToken
          );

          if (workerDEBUG) {
            logAction(
              originalAccountIndex,
              acc.wallet,
              proxyURL,
              `Phản hồi từ /api/meme/project/list (Lần thử ${projectFetchAttempts}): ${JSON.stringify(
                memeProjectsResponse
              )}`,
              "info",
              null,
              true,
              workerDEBUG
            );
          }

          if (
            memeProjectsResponse &&
            !memeProjectsResponse.error &&
            memeProjectsResponse.code === 200 &&
            memeProjectsResponse.debug &&
            memeProjectsResponse.debug.records
          ) {
            projects = memeProjectsResponse.debug.records;
            projectFetchSuccess = true;
            if (workerDEBUG && projects.length > 0)
              logAction(
                originalAccountIndex,
                acc.wallet,
                proxyURL,
                `Lấy được ${projects.length} meme projects.`,
                "info",
                null,
                true,
                workerDEBUG
              );
          } else {
            lastProjectFetchErrorMsg =
              memeProjectsResponse.message ||
              (memeProjectsResponse.data
                ? JSON.stringify(memeProjectsResponse.data)
                : memeProjectsResponse.error
                ? memeProjectsResponse.message
                : "Lỗi không xác định khi lấy project list");

            logAction(
              originalAccountIndex,
              acc.wallet,
              proxyURL,
              `Lần ${projectFetchAttempts}: Không lấy được danh sách project meme. Lỗi API: ${lastProjectFetchErrorMsg}`,
              "warn",
              null,
              false,
              workerDEBUG
            );

            const isRetryableError =
              memeProjectsResponse.status === 500 ||
              memeProjectsResponse.status === 502 ||
              memeProjectsResponse.status === 503 ||
              memeProjectsResponse.status === 504 ||
              (memeProjectsResponse.status >= 420 &&
                memeProjectsResponse.status <= 429) ||
              (lastProjectFetchErrorMsg &&
                lastProjectFetchErrorMsg
                  .toLowerCase()
                  .includes("system error!"));
            if (
              !isRetryableError ||
              projectFetchAttempts >= maxProjectFetchRetries
            ) {
              break;
            }
          }
        }

        if (!projectFetchSuccess) {
          logAction(
            originalAccountIndex,
            acc.wallet,
            proxyURL,
            `Không lấy được danh sách project meme sau ${projectFetchAttempts} lần thử. Lỗi cuối: ${lastProjectFetchErrorMsg}. Bỏ qua voting.`,
            "error",
            null,
            false,
            workerDEBUG
          );
          resultAcc.error =
            (resultAcc.error ? resultAcc.error + "; " : "") +
            `Meme voting: Failed to fetch project list: ${lastProjectFetchErrorMsg}`;
          resultAcc.status = "VOTE_PROJECT_LIST_FAILED";
        } else {
          if (projects.length === 0 && workerDEBUG)
            logAction(
              originalAccountIndex,
              acc.wallet,
              proxyURL,
              `Không có project nào trong danh sách meme.`,
              "warn",
              null,
              true,
              workerDEBUG
            );

          let projectToVote = null;
          if (workerMemeTargetId !== 0) {
            projectToVote = projects.find((p) => p.id === workerMemeTargetId);
            if (!projectToVote)
              logAction(
                originalAccountIndex,
                acc.wallet,
                proxyURL,
                `Không tìm thấy project ID mục tiêu: ${workerMemeTargetId}. Sẽ thử project đầu tiên nếu có.`,
                "warn",
                null,
                false,
                workerDEBUG
              );
          }

          if (!projectToVote && projects.length > 0) {
            projectToVote = projects.sort(
              (a, b) => (a.orderNo || 999) - (b.orderNo || 999)
            )[0];
            if (workerMemeTargetId === 0)
              logAction(
                originalAccountIndex,
                acc.wallet,
                proxyURL,
                `Không có ID mục tiêu, chọn project: ${projectToVote.name} (ID: ${projectToVote.id})`,
                "info",
                null,
                false,
                workerDEBUG
              );
            else if (projectToVote)
              logAction(
                originalAccountIndex,
                acc.wallet,
                proxyURL,
                `Target ID ${workerMemeTargetId} không thấy, chọn project: ${projectToVote.name} (ID: ${projectToVote.id})`,
                "info",
                null,
                false,
                workerDEBUG
              );
          } else if (!projectToVote) {
            logAction(
              originalAccountIndex,
              acc.wallet,
              proxyURL,
              `Không có project meme nào để vote.`,
              "warn",
              null,
              false,
              workerDEBUG
            );
          }

          if (projectToVote) {
            let votesToAttemptInPayload;
            if (workerMemeUseAllScore) {
              votesToAttemptInPayload = currentScore;
              if (workerDEBUG)
                logAction(
                  originalAccountIndex,
                  acc.wallet,
                  proxyURL,
                  `Chế độ Vote tất cả score: Sẽ thử gửi voteNum=${votesToAttemptInPayload} cho project ${projectToVote.name}`,
                  "info",
                  null,
                  true,
                  workerDEBUG
                );
            } else {
              votesToAttemptInPayload = Math.min(
                currentScore,
                workerMemeVotesPerProjectConfig
              );
              if (
                workerDEBUG &&
                currentScore < workerMemeVotesPerProjectConfig &&
                votesToAttemptInPayload > 0 &&
                votesToAttemptInPayload < workerMemeVotesPerProjectConfig
              ) {
                logAction(
                  originalAccountIndex,
                  acc.wallet,
                  proxyURL,
                  `Số vote cấu hình (${workerMemeVotesPerProjectConfig}) đã được giới hạn bởi score (${currentScore}). Vote: ${votesToAttemptInPayload}`,
                  "info",
                  null,
                  true,
                  workerDEBUG
                );
              }
            }

            if (votesToAttemptInPayload < 1) {
              logAction(
                originalAccountIndex,
                acc.wallet,
                proxyURL,
                `Số lượng vote tính toán được (${votesToAttemptInPayload}) < 1. Không thực hiện vote.`,
                "info",
                null,
                false,
                workerDEBUG
              );
              if (resultAcc.status === "LOGIN_SUCCESS")
                resultAcc.status = "VOTE_SKIPPED_NO_VOTES_TO_CAST";
            } else {
              logAction(
                originalAccountIndex,
                acc.wallet,
                proxyURL,
                `Sẽ thử vote ${votesToAttemptInPayload} lượt cho project: ${projectToVote.name} (ID: ${projectToVote.id})`,
                "info",
                null,
                false,
                workerDEBUG
              );

              let voteSuccessfulAttempt = false;
              let voteAttempts = 0;
              const maxVoteAttemptsTotal = 1 + workerVoteMaxRetries;
              let lastVoteErrorMsg = `Vote failed for ${projectToVote.name}`;

              while (
                !voteSuccessfulAttempt &&
                voteAttempts < maxVoteAttemptsTotal
              ) {
                voteAttempts++;
                if (voteAttempts > 1) {
                  logAction(
                    originalAccountIndex,
                    acc.wallet,
                    proxyURL,
                    `Vote attempt ${voteAttempts}/${maxVoteAttemptsTotal} cho project ${projectToVote.id}...`,
                    "warn",
                    null,
                    false,
                    workerDEBUG
                  );
                  const currentVoteRetryDelay =
                    Math.floor(
                      Math.random() *
                        (workerRetryDelayMax - workerRetryDelayMin + 1)
                    ) + workerRetryDelayMin;
                  if (currentVoteRetryDelay > 0) {
                    if (workerDEBUG)
                      logAction(
                        originalAccountIndex,
                        acc.wallet,
                        proxyURL,
                        `Chờ ${
                          currentVoteRetryDelay / 1000
                        }s trước khi thử lại vote...`,
                        "info",
                        null,
                        true,
                        workerDEBUG
                      );
                    await new Promise((resolve) =>
                      setTimeout(resolve, currentVoteRetryDelay)
                    );
                  }
                }

                const votePayload = {
                  projectId: projectToVote.id,
                  voteNum: votesToAttemptInPayload,
                };
                const voteApiEndpoint = `/api/taskwall/meme/vote`;
                const voteResponse = await callWithDelayLocal(
                  voteApiEndpoint,
                  "POST",
                  votePayload,
                  currentToken
                );

                if (!voteResponse.error && voteResponse.code === 200) {
                  logAction(
                    originalAccountIndex,
                    acc.wallet,
                    proxyURL,
                    `Vote ${votesToAttemptInPayload} lượt THÀNH CÔNG cho ${projectToVote.name} (Lần thử ${voteAttempts})`,
                    "success",
                    null,
                    false,
                    workerDEBUG
                  );
                  resultAcc.memeVotesCastThisRun =
                    (resultAcc.memeVotesCastThisRun || 0) +
                    votesToAttemptInPayload;
                  voteSuccessfulAttempt = true;
                  resultAcc.status = "VOTED_SUCCESSFULLY";
                  resultAcc.error = null;
                } else {
                  const voteErrCode =
                    voteResponse.status || voteResponse.code || "N/A";
                  lastVoteErrorMsg =
                    voteResponse.message ||
                    (voteResponse.data
                      ? JSON.stringify(voteResponse.data)
                      : "Lỗi khi vote");
                  logAction(
                    originalAccountIndex,
                    acc.wallet,
                    proxyURL,
                    `Vote attempt ${voteAttempts} cho ${projectToVote.name} THẤT BẠI. Code: ${voteErrCode}, Msg: ${lastVoteErrorMsg}`,
                    "error",
                    null,
                    false,
                    workerDEBUG
                  );

                  const retryableVoteErrorMessages = [
                    "please try again later",
                    "network error",
                    "timeout",
                    "limit",
                    "system error!",
                  ];
                  const isRetryableError =
                    voteErrCode === 500 ||
                    voteErrCode === 502 ||
                    voteErrCode === 503 ||
                    voteErrCode === 504 ||
                    (voteErrCode >= 420 && voteErrCode <= 429) ||
                    (lastVoteErrorMsg &&
                      retryableVoteErrorMessages.some((e) =>
                        lastVoteErrorMsg.toLowerCase().includes(e.toLowerCase())
                      ));

                  if (
                    !isRetryableError ||
                    voteAttempts >= maxVoteAttemptsTotal
                  ) {
                    resultAcc.error =
                      (resultAcc.error ? resultAcc.error + "; " : "") +
                      `Meme vote for ${projectToVote.name} failed: ${lastVoteErrorMsg}`;
                    resultAcc.status = "VOTE_FAILED";
                    break;
                  }
                }
              }
            }
          }
        }
      } else if (
        resultAcc.status !== "FETCH_SCORE_FAILED" &&
        resultAcc.status !== "LOGIN_FAILED"
      ) {
        logAction(
          originalAccountIndex,
          acc.wallet,
          proxyURL,
          `Score (${currentScore}) < mức tối thiểu (${workerMemeMinScoreToAct}) hoặc bằng 0. Bỏ qua voting.`,
          "info",
          null,
          false,
          workerDEBUG
        );
        if (
          resultAcc.status === "LOGIN_SUCCESS" ||
          resultAcc.status === "PENDING" ||
          resultAcc.status === "SKIPPED_ALREADY_CHECKED_IN"
        ) {
          resultAcc.status = "VOTE_SKIPPED_LOW_SCORE";
        }
      }
    }

    if (resultAcc.status === "PENDING" && !resultAcc.error) {
      resultAcc.status = "COMPLETED_SUCCESSFULLY_NO_ACTION";
    } else if (
      resultAcc.status === "LOGIN_SUCCESS" &&
      !resultAcc.error &&
      !workerEnableMemeVoting
    ) {
      resultAcc.status = "COMPLETED_NO_VOTING_DISABLED";
    } else if (
      resultAcc.status === "LOGIN_SUCCESS" &&
      !resultAcc.error &&
      workerEnableMemeVoting &&
      resultAcc.status !== "VOTED_SUCCESSFULLY" &&
      resultAcc.status !== "VOTE_FAILED" &&
      resultAcc.status !== "VOTE_PROJECT_LIST_FAILED" &&
      resultAcc.status !== "FETCH_SCORE_FAILED" &&
      resultAcc.status !== "VOTE_SKIPPED_LOW_SCORE" &&
      resultAcc.status !== "SKIPPED_ALREADY_CHECKED_IN"
    ) {
      resultAcc.status = "COMPLETED_VOTING_SKIPPED_OR_NO_TARGET";
    } else if (
      resultAcc.status === "SKIPPED_ALREADY_CHECKED_IN" &&
      !resultAcc.error
    ) {
      // Status đã được set
    } else if (resultAcc.status === "LOGIN_SUCCESS" && !resultAcc.error) {
      resultAcc.status = "COMPLETED_OK_NO_VOTE_ACTION";
    }

    logAction(
      originalAccountIndex,
      acc.wallet,
      proxyURL,
      `Hoàn thành xử lý worker. Status: ${resultAcc.status || "UNKNOWN"}. ${
        resultAcc.error ? `Lỗi cuối: ${resultAcc.error}` : "Không có lỗi."
      }`,
      "info",
      null,
      false,
      workerDEBUG
    );
    parentPort.postMessage(resultAcc);
  })();
} else {
  // MainThread
  (async () => {
    try {
      if (AUTO_GENERATE_ACCOUNT_JSON_FROM_TXT) {
        const pkFile = path.join(__dirname, "private_key.txt");
        const addrFile = path.join(__dirname, "address.txt");
        logAction(
          null,
          null,
          null,
          `Đang cố gắng tạo account.json từ ${pkFile} và ${addrFile}...`,
          "info",
          null,
          false,
          DEBUG
        );
        const generated = generateAccountJsonFromTxtFiles(
          defaultRefCode,
          DEBUG
        );
        if (
          !generated &&
          !fs.existsSync(path.join(__dirname, "account.json"))
        ) {
          logAction(
            null,
            null,
            null,
            `Không thể tạo account.json từ file .txt và account.json cũng không tồn tại. Vui lòng kiểm tra file.`,
            "error",
            null,
            false,
            DEBUG
          );
          return;
        } else if (
          !generated &&
          fs.existsSync(path.join(__dirname, "account.json"))
        ) {
          logAction(
            null,
            null,
            null,
            `Không tạo được account.json từ file .txt, sẽ sử dụng account.json hiện có (nếu có).`,
            "warn",
            null,
            false,
            DEBUG
          );
        }
      } else {
        if (!fs.existsSync(path.join(__dirname, "account.json"))) {
          logAction(
            null,
            null,
            null,
            "AUTO_GENERATE_ACCOUNT_JSON_FROM_TXT=false và file account.json không tồn tại. Vui lòng tạo file account.json hoặc bật tự động tạo.",
            "error",
            null,
            false,
            DEBUG
          );
          return;
        }
        if (DEBUG)
          logAction(
            null,
            null,
            null,
            "Bỏ qua bước tạo account.json từ file .txt do cấu hình AUTO_GENERATE_ACCOUNT_JSON_FROM_TXT=false.",
            "info",
            null,
            true,
            DEBUG
          );
      }

      logAction(
        null,
        null,
        null,
        "Đang tải danh sách proxy...",
        "info",
        null,
        false,
        DEBUG
      );
      loadProxies(DEBUG);

      const requireProxy = process.env.REQUIRE_PROXY === "true";
      // if (utils.getProxyListLength() === 0 && requireProxy) { ... }

      logAction(
        null,
        null,
        null,
        "Đang đọc danh sách tài khoản từ account.json...",
        "info",
        null,
        false,
        DEBUG
      );
      let allOriginalAccounts = readAccountsFromJSON(DEBUG);

      if (!allOriginalAccounts || allOriginalAccounts.length === 0) {
        logAction(
          null,
          null,
          null,
          "Không tìm thấy tài khoản nào trong account.json hoặc file rỗng/lỗi.",
          "error",
          null,
          false,
          DEBUG
        );
        return;
      }

      allOriginalAccounts = allOriginalAccounts
        .map((acc, index) => ({ ...acc, originalIndexInFullList: index }))
        .filter((acc) => {
          const isValid = acc && acc.wallet && acc.private_key;
          if (!isValid && DEBUG) {
            logAction(
              acc.originalIndexInFullList,
              acc.wallet || "N/A",
              null,
              `Loại bỏ tài khoản không hợp lệ.`,
              "warn",
              null,
              true,
              DEBUG
            );
          }
          return isValid;
        });

      if (allOriginalAccounts.length === 0) {
        logAction(
          null,
          null,
          null,
          "Không còn tài khoản hợp lệ nào để xử lý sau khi lọc.",
          "error",
          null,
          false,
          DEBUG
        );
        return;
      }

      const accountsForJsonFile = allOriginalAccounts.map((acc) => {
        const cleanAcc = { ...acc };
        if (!cleanAcc.ref || cleanAcc.ref.trim() === "") {
          if (DEBUG && cleanAcc.wallet)
            logAction(
              cleanAcc.originalIndexInFullList,
              cleanAcc.wallet,
              null,
              `Không có ref, sử dụng ref mặc định: ${defaultRefCode}`,
              "info",
              null,
              true,
              DEBUG
            );
          cleanAcc.ref = defaultRefCode;
        }
        delete cleanAcc.memeVotesCastThisRun;
        delete cleanAcc.currentScoreAfterVote;
        delete cleanAcc.status;
        delete cleanAcc.error;
        return cleanAcc;
      });
      updateAccountJSON(accountsForJsonFile, DEBUG);

      let accountsToProcess = [...allOriginalAccounts];

      logAction(
        null,
        null,
        null,
        `Bắt đầu xử lý ${accountsToProcess.length} tài khoản với ${numThreads} luồng...`,
        "info",
        null,
        false,
        DEBUG
      );
      await runWorkerBatch(accountsToProcess, numThreads);

      logAction(
        null,
        null,
        null,
        "🎉 Hoàn tất xử lý tất cả tài khoản!",
        "success",
        null,
        false,
        DEBUG
      );

      const restartDelayHoursEnv = parseFloat(process.env.RESTART_DELAY_HOURS);
      if (!isNaN(restartDelayHoursEnv) && restartDelayHoursEnv > 0) {
        const restartDelaySeconds = Math.max(1, restartDelayHoursEnv * 3600);
        startCountdown(restartDelaySeconds, DEBUG);
      } else {
        logAction(
          null,
          null,
          null,
          "RESTART_DELAY_HOURS <= 0 hoặc không hợp lệ, bot sẽ không tự khởi động lại. Kết thúc.",
          "info",
          null,
          false,
          DEBUG
        );
        process.exit(0);
      }
    } catch (err) {
      console.error("Đã xảy ra lỗi nghiêm trọng ở MainThread:".red, err);
      process.exit(1);
    }
  })();
}
