async function loadMyDocuments() {
  if (currentRole !== "Intern") return;
  try {
    const res = await fetch(`${API_BASE}/applications/me/documents`, {
      headers: authHeaders(),
    });
    if (res.status === 401) {
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    }
    const body = await res.json();
    if (!res.ok || !body.success) throw new Error(body.message);
    myProfileState = body.data;
    renderMyDocumentsUI();
  } catch (err) {
    console.error("Lỗi tải hồ sơ của tôi:", err);
    showToast(
      err.message || "Không thể tải danh sách tài liệu hồ sơ!",
      "error",
    );
  }
}

function renderMyDocumentsUI() {
  if (!myProfileState) return;
  const { application, documents, progress } = myProfileState;

  // 1. Banner chỉ hiện khi hồ sơ bị từ chối (đã duyệt thì không hiện, Intern vẫn tải tài liệu được)
  const bannerEl = document.getElementById("profileStatusBanner");
  if (application.is_locked) {
    bannerEl.style.display = "block";
    bannerEl.style.padding = "14px 18px";
    bannerEl.style.borderRadius = "8px";
    bannerEl.style.background = "#fef2f2";
    bannerEl.style.border = "1px solid #fecaca";
    bannerEl.style.color = "#991b1b";
    bannerEl.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
              <i class="fa-solid fa-circle-xmark" style="font-size: 22px;"></i>
              <div>
                <b>Trạng thái hồ sơ: ${escapeHtml(application.status)}</b>
                <div style="font-size: 14.5px; margin-top: 2px;">${escapeHtml(application.lock_reason)}</div>
              </div>
            </div>
          `;
  } else {
    bannerEl.style.display = "none";
  }

  // 2. Cập nhật thẻ tiến độ
  const progressTextEl = document.getElementById("profileProgressText");
  const progressBarEl = document.getElementById("profileProgressBar");
  const progressBadgeEl = document.getElementById("profileProgressBadge");

  progressTextEl.innerText = `${progress.totalUploaded}/2 tài liệu bắt buộc đã nộp`;
  progressBarEl.style.width = `${progress.percent}%`;

  if (progress.isComplete) {
    progressBadgeEl.innerHTML = `<span class="badge badge-active"><i class="fa-solid fa-check"></i> Đã đủ hồ sơ</span>`;
    progressBarEl.style.background = "#10b981";
  } else {
    progressBadgeEl.innerHTML = `<span class="badge badge-pending"><i class="fa-solid fa-clock"></i> Chưa đủ hồ sơ</span>`;
    progressBarEl.style.background = "var(--primary)";
  }

  // 3. Render tài liệu CV
  const cvDoc = (documents || []).find((d) => d.doc_type === "CV");
  renderDocCard("CV", cvDoc, application.is_locked, application.lock_reason);

  // 4. Render tài liệu ĐƠN XIN THỰC TẬP
  const letterDoc = (documents || []).find(
    (d) => d.doc_type === "APPLICATION_LETTER",
  );
  renderDocCard(
    "APPLICATION_LETTER",
    letterDoc,
    application.is_locked,
    application.lock_reason,
  );
}

function renderDocCard(docType, doc, isLocked, lockReason) {
  const isCv = docType === "CV";
  const prefix = isCv ? "cv" : "letter";
  const suffix = isCv ? "Cv" : "Letter";
  const uploading = uploadingTypes.has(docType);

  const badgeEl = document.getElementById(`${prefix}StatusBadge`);
  const dropZoneEl = document.getElementById(`${prefix}DropZone`);
  const infoBoxEl = document.getElementById(`${prefix}DocInfoBox`);
  const nameEl = document.getElementById(`${prefix}FileName`);
  const sizeEl = document.getElementById(`${prefix}FileSize`);
  const timeEl = document.getElementById(`${prefix}FileTime`);
  const lockNoteEl = document.getElementById(`${prefix}LockNote`);
  const btnReplace = document.getElementById(`btnReplace${suffix}`);
  const btnDelete = document.getElementById(`btnDelete${suffix}`);

  // Lý do khóa hiển thị thẳng trên thẻ (tooltip không hiện trên nút disabled / thiết bị cảm ứng)
  if (isLocked) {
    lockNoteEl.style.display = "block";
    lockNoteEl.innerHTML = `<i class="fa-solid fa-lock"></i> ${escapeHtml(
      lockReason || "Hồ sơ đã được xử lý, không thể thay đổi tài liệu.",
    )}`;
  } else {
    lockNoteEl.style.display = "none";
    lockNoteEl.innerHTML = "";
  }

  if (doc) {
    badgeEl.className = "badge badge-active";
    badgeEl.innerHTML = `<i class="fa-solid fa-check"></i> Đã nộp`;
    dropZoneEl.style.display = "none";
    infoBoxEl.style.display = "block";

    nameEl.textContent = doc.original_name;
    nameEl.title = doc.original_name;
    sizeEl.textContent = formatFileSize(doc.size_bytes);
    timeEl.textContent = formatDateTime(doc.updated_at || doc.uploaded_at);

    btnReplace.disabled = isLocked || uploading;
    btnDelete.disabled = isLocked || uploading;
    btnReplace.title = isLocked ? lockReason : "Thay thế bằng file mới";
    btnDelete.title = isLocked ? lockReason : "Xóa file này khỏi hệ thống";
  } else {
    badgeEl.className = "badge badge-pending";
    badgeEl.textContent = "Chưa nộp";
    dropZoneEl.style.display = isLocked ? "none" : "block";
    dropZoneEl.classList.toggle("is-busy", uploading);
    infoBoxEl.style.display = "none";
  }
}

function triggerChooseFile(docType) {
  if (
    myProfileState &&
    myProfileState.application &&
    myProfileState.application.is_locked
  ) {
    showToast(
      "Hồ sơ đã được xử lý, không thể tải lên hoặc thay đổi tài liệu!",
      "error",
    );
    return;
  }
  const inputId = docType === "CV" ? "cvFileInput" : "letterFileInput";
  const inputEl = document.getElementById(inputId);
  if (inputEl) inputEl.click();
}

function handleDragOver(e, docType) {
  e.preventDefault();
  e.stopPropagation();
  if (
    myProfileState &&
    myProfileState.application &&
    myProfileState.application.is_locked
  )
    return;
  const prefix = docType === "CV" ? "cv" : "letter";
  document.getElementById(`${prefix}DropZone`).classList.add("dragover");
}

function handleDragLeave(e, docType) {
  e.preventDefault();
  e.stopPropagation();
  const prefix = docType === "CV" ? "cv" : "letter";
  document.getElementById(`${prefix}DropZone`).classList.remove("dragover");
}

function handleDrop(e, docType) {
  e.preventDefault();
  e.stopPropagation();
  const prefix = docType === "CV" ? "cv" : "letter";
  document.getElementById(`${prefix}DropZone`).classList.remove("dragover");

  if (
    myProfileState &&
    myProfileState.application &&
    myProfileState.application.is_locked
  ) {
    showToast("Hồ sơ đã được xử lý, không thể tải lên tài liệu!", "error");
    return;
  }

  const files = e.dataTransfer.files;
  if (files && files.length > 0) {
    if (files.length > 1) {
      showToast(
        "Mỗi lần chỉ tải lên 1 file, hệ thống lấy file đầu tiên.",
        "info",
      );
    }
    uploadDocumentFile(docType, files[0]);
  }
}

function handleFileSelected(docType, inputEl) {
  if (inputEl.files && inputEl.files.length > 0) {
    uploadDocumentFile(docType, inputEl.files[0]);
    inputEl.value = "";
  }
}

function validateFileBeforeUpload(file) {
  if (!file) {
    showToast("Vui lòng chọn file để tải lên!", "error");
    return false;
  }

  const allowedExts = [".pdf", ".doc", ".docx"];
  const name = file.name || "";
  const dotIdx = name.lastIndexOf(".");
  const ext = dotIdx !== -1 ? name.substring(dotIdx).toLowerCase() : "";

  if (!allowedExts.includes(ext)) {
    showToast(
      `Định dạng file '${ext || "không rõ"}' không được hỗ trợ! Chỉ nhận file PDF (.pdf) hoặc Word (.doc, .docx).`,
      "error",
    );
    return false;
  }

  if (file.size <= 0) {
    showToast("File rỗng (0 bytes)! Vui lòng chọn file có nội dung.", "error");
    return false;
  }

  if (file.size > 5 * 1024 * 1024) {
    showToast(
      `Dung lượng file (${(file.size / (1024 * 1024)).toFixed(2)}MB) vượt quá giới hạn tối đa 5MB!`,
      "error",
    );
    return false;
  }

  return true;
}

function uploadDocumentFile(docType, file) {
  if (uploadingTypes.has(docType)) {
    showToast("Đang tải lên, vui lòng chờ hoàn tất!", "info");
    return;
  }
  if (!validateFileBeforeUpload(file)) return;

  const prefix = docType === "CV" ? "cv" : "letter";
  const progressContainer = document.getElementById(
    `${prefix}UploadProgressContainer`,
  );
  const progressBar = document.getElementById(`${prefix}UploadProgressBar`);
  const progressPercent = document.getElementById(
    `${prefix}UploadProgressPercent`,
  );
  const progressLabel = document.getElementById(`${prefix}UploadProgressLabel`);

  progressContainer.style.display = "block";
  progressBar.style.width = "0%";
  progressPercent.textContent = "0%";
  progressLabel.textContent = "Đang tải lên...";
  uploadingTypes.add(docType);
  renderMyDocumentsUI();

  const finish = () => {
    progressContainer.style.display = "none";
    uploadingTypes.delete(docType);
    renderMyDocumentsUI();
  };

  const formData = new FormData();
  formData.append("doc_type", docType);
  formData.append("file", file);

  const xhr = new XMLHttpRequest();
  xhr.open("POST", `${API_BASE}/applications/me/documents`);
  xhr.setRequestHeader("Authorization", `Bearer ${getAuthToken()}`);
  xhr.timeout = 120000;

  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const percent = Math.round((e.loaded / e.total) * 100);
    progressBar.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;
    if (percent >= 100)
      progressLabel.textContent = "Đang kiểm tra & lưu tài liệu...";
  };

  xhr.onload = () => {
    let res = {};
    try {
      res = JSON.parse(xhr.responseText || "{}");
    } catch (e) {
      // Phản hồi không phải JSON: giữ res = {} và xử lý theo mã trạng thái bên dưới.
    }
    finish();

    if (xhr.status === 401) {
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    }
    if (xhr.status >= 200 && xhr.status < 300 && res.success) {
      showToast(res.message || "Tải lên tài liệu thành công!", "success");
      loadMyDocuments();
      return;
    }
    showToast(
      res.message || res.error || "Tải lên tài liệu thất bại!",
      "error",
    );
    // 409: hồ sơ vừa bị HR xử lý -> đồng bộ lại trạng thái khóa trên giao diện
    if (xhr.status === 409) loadMyDocuments();
  };

  xhr.onerror = () => {
    finish();
    showToast("Không thể kết nối tới máy chủ khi tải lên file!", "error");
  };
  xhr.ontimeout = () => {
    finish();
    showToast("Tải lên quá thời gian chờ, vui lòng thử lại!", "error");
  };
  xhr.onabort = () => {
    finish();
    showToast("Đã hủy tải lên tài liệu.", "info");
  };

  xhr.send(formData);
}

async function downloadCurrentDoc(docType) {
  if (!myProfileState || !myProfileState.documents) return;
  const doc = myProfileState.documents.find((d) => d.doc_type === docType);
  if (!doc) {
    showToast("Chưa có tài liệu để tải xuống!", "error");
    return;
  }
  await downloadDocumentFile(
    myProfileState.application.id,
    doc.id,
    doc.original_name,
  );
}

async function downloadDocumentFile(applicationId, docId, filename) {
  try {
    showToast("Đang chuẩn bị tải file...", "info");
    const res = await fetch(
      `${API_BASE}/applications/${applicationId}/documents/${docId}/download`,
      { headers: authHeaders() },
    );

    if (res.status === 401) {
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.message || "Tải xuống tài liệu thất bại!", "error");
      return;
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = filename || "document";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 200);

    showToast("Tải xuống tài liệu thành công!", "success");
  } catch (err) {
    showToast("Lỗi khi tải xuống tài liệu!", "error");
  }
}

async function deleteCurrentDoc(docType) {
  if (!myProfileState || !myProfileState.documents) return;
  const doc = myProfileState.documents.find((d) => d.doc_type === docType);
  if (!doc) return;

  const docName = docType === "CV" ? "CV" : "Đơn xin thực tập";
  if (
    !confirm(
      `Bạn có chắc chắn muốn xóa ${docName} (${doc.original_name}) không?`,
    )
  ) {
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/applications/me/documents/${doc.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (res.status === 401) {
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      showToast(body.message || "Xóa tài liệu thất bại!", "error");
      if (res.status === 409) loadMyDocuments();
      return;
    }

    showToast(body.message || "Đã xóa tài liệu thành công!", "success");
    loadMyDocuments();
  } catch (err) {
    showToast("Lỗi kết nối khi xóa tài liệu!", "error");
  }
}
