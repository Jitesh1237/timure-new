import { useState, useEffect, useRef, useCallback } from 'react';
import {
  login as apiLogin,
  fetchAllGallery,
  uploadGalleryImage,
  createGalleryImage,
  updateGalleryImage,
  deleteGalleryImage,
  fetchSettings,
  updateSettings,
  changePassword,
} from '../api';

// Default site image keys
const SITE_IMAGE_KEYS = [
  { key: 'fleet_bus_img', label: '🚌 Fleet Card 1 — Deluxe Bus', placeholder: 'Image URL for Deluxe Bus fleet card' },
  { key: 'fleet_evasuwa_img', label: '⚡ Fleet Card 2 — EV AC Micro Rasuwa', placeholder: 'Image URL for EV AC Micro Rasuwa fleet card' },
  { key: 'fleet_trishuli_img', label: '🚐 Fleet Card 3 — EV AC Micro Trishuli', placeholder: 'Image URL for EV AC Micro Trishuli fleet card' },
  { key: 'about_img', label: '🏢 About Section Image', placeholder: 'Image URL for the About section' },
  { key: 'gallery_fallback_img', label: '🖼️ Gallery Fallback Image', placeholder: 'Image URL shown when gallery is empty' },
  { key: 'admin_bg_img', label: '🎨 Admin Panel Background', placeholder: 'Image URL for the admin panel background' },
];

export default function AdminPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem('admin_token'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [images, setImages] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [imageUrl, setImageUrl] = useState('');
  const [imageTitle, setImageTitle] = useState('');
  const [imageOrder, setImageOrder] = useState('0');
  const [imageFile, setImageFile] = useState(null);
  const [previewSrc, setPreviewSrc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const fileInputRef = useRef(null);

  // Site images state
  const [siteImages, setSiteImages] = useState({});
  const [siteImagesLoading, setSiteImagesLoading] = useState(false);
  const [siteImagesSaving, setSiteImagesSaving] = useState(false);
  const [siteImagesSaved, setSiteImagesSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('gallery');
  const siteFileRefs = useRef({});

  // Change password state
  const [cpCurrent, setCpCurrent] = useState('');
  const [cpNew, setCpNew] = useState('');
  const [cpConfirm, setCpConfirm] = useState('');
  const [cpLoading, setCpLoading] = useState(false);
  const [cpError, setCpError] = useState('');
  const [cpSuccess, setCpSuccess] = useState(false);

  // Load data when token is available (on mount if session exists, or after login)
  useEffect(() => {
    if (token) {
      loadGallery();
      loadSiteImages();
    }
  }, [token]);

  const loadGallery = useCallback(async () => {
    try {
      const imgs = await fetchAllGallery(token);
      setImages(imgs);
    } catch (e) {
      if (e.message === 'Unauthorized') logout();
    }
  }, [token]);

  const loadSiteImages = useCallback(async () => {
    setSiteImagesLoading(true);
    try {
      const settings = await fetchSettings();
      setSiteImages(settings);
    } catch (e) {
      console.error('Failed to load site settings', e);
    }
    setSiteImagesLoading(false);
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    const u = username.trim();
    const p = password.trim();
    if (!u || !p) {
      setLoginError('Please enter both fields');
      return;
    }
    setLoading(true);
    try {
      const data = await apiLogin(u, p);
      sessionStorage.setItem('admin_token', data.token);
      setToken(data.token);
      setLoginError('');
    } catch (e) {
      setLoginError(e.message || 'Login failed');
    }
    setLoading(false);
  };

  const logout = () => {
    sessionStorage.removeItem('admin_token');
    setToken(null);
    setImages([]);
    setSiteImages({});
    resetForm();
  };

  const resetForm = () => {
    setEditingId(null);
    setImageUrl('');
    setImageTitle('');
    setImageOrder('0');
    setImageFile(null);
    setPreviewSrc(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = (ev) => setPreviewSrc(ev.target.result);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setActionLoading(true);

    try {
      let finalUrl = imageUrl.trim();

      if (imageFile) {
        const fd = new FormData();
        fd.append('image', imageFile);
        const uploadData = await uploadGalleryImage(token, fd);
        if (uploadData.url) {
          finalUrl = uploadData.url;
        } else {
          alert('Upload failed');
          setActionLoading(false);
          return;
        }
      }

      if (!finalUrl) {
        alert('Please provide an image URL or file');
        setActionLoading(false);
        return;
      }

      const body = {
        image_url: finalUrl,
        title: imageTitle.trim() || '',
        sort_order: parseInt(imageOrder) || 0,
      };

      if (editingId) {
        await updateGalleryImage(token, editingId, body);
      } else {
        await createGalleryImage(token, body);
      }

      resetForm();
      await loadGallery();
    } catch (e) {
      alert(e.message || 'Error');
    }
    setActionLoading(false);
  };

  const handleEdit = (id) => {
    const img = images.find((i) => i.id === id);
    if (!img) return;
    setEditingId(id);
    setImageUrl(img.image_url);
    setImageTitle(img.title || '');
    setImageOrder(String(img.sort_order || 0));
    setPreviewSrc(img.image_url);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleToggle = async (id) => {
    const img = images.find((i) => i.id === id);
    if (!img) return;
    setActionLoading(true);
    try {
      await updateGalleryImage(token, id, { is_active: !img.is_active });
      await loadGallery();
    } catch (e) {
      alert('Error');
    }
    setActionLoading(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this image?')) return;
    setActionLoading(true);
    try {
      await deleteGalleryImage(token, id);
      await loadGallery();
    } catch (e) {
      alert('Error');
    }
    setActionLoading(false);
  };

  // ─── SITE IMAGE HANDLERS ───
  const handleSiteImageChange = (key, value) => {
    setSiteImages((prev) => ({ ...prev, [key]: value }));
    setSiteImagesSaved(false);
  };

  const handleSiteImageFile = async (key, file) => {
    if (!file) return;
    setSiteImagesLoading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const uploadData = await uploadGalleryImage(token, fd);
      if (uploadData.url) {
        setSiteImages((prev) => ({ ...prev, [key]: uploadData.url }));
        setSiteImagesSaved(false);
      }
    } catch (e) {
      alert('Upload failed: ' + e.message);
    }
    setSiteImagesLoading(false);
  };

  // ─── CHANGE PASSWORD HANDLER ───
  const handleChangePassword = async (e) => {
    e.preventDefault();
    setCpError('');
    setCpSuccess(false);

    if (!cpCurrent || !cpNew || !cpConfirm) {
      setCpError('Please fill in all fields');
      return;
    }
    if (cpNew.length < 6) {
      setCpError('New password must be at least 6 characters');
      return;
    }
    if (cpNew !== cpConfirm) {
      setCpError('New passwords do not match');
      return;
    }
    if (cpCurrent === cpNew) {
      setCpError('New password must be different from current password');
      return;
    }

    setCpLoading(true);
    try {
      await changePassword(token, cpCurrent, cpNew);
      setCpSuccess(true);
      setCpCurrent('');
      setCpNew('');
      setCpConfirm('');
      setTimeout(() => setCpSuccess(false), 5000);
    } catch (e) {
      setCpError(e.message || 'Failed to change password');
    }
    setCpLoading(false);
  };

  const saveSiteImages = async () => {
    setSiteImagesSaving(true);
    try {
      await updateSettings(token, siteImages);
      setSiteImagesSaved(true);
      setTimeout(() => setSiteImagesSaved(false), 3000);
    } catch (e) {
      alert('Failed to save: ' + e.message);
    }
    setSiteImagesSaving(false);
  };

  // Background image style (dark overlay keeps text readable)
  const adminBgStyle = siteImages.admin_bg_img
    ? { background: `linear-gradient(rgba(15, 17, 23, 0.88), rgba(15, 17, 23, 0.88)), url(${siteImages.admin_bg_img}) center/cover fixed` }
    : {};

  // ─── LOGIN VIEW ───
  if (!token) {
    return (
      <div className="admin-page" style={adminBgStyle}>
        <h1 className="admin-title">🚌 Timure Yatayat — Admin</h1>
        <div className="login-box">
          <h2>🔐 Admin Login</h2>
          <form onSubmit={handleLogin}>
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') document.getElementById('admin-password')?.focus();
              }}
            />
            <input
              id="admin-password"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLogin(e);
              }}
            />
            <button type="submit" disabled={loading}>
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>
          {loginError && <div className="error-msg">{loginError}</div>}
        </div>
      </div>
    );
  }

  // ─── DASHBOARD VIEW ───
  return (
    <div className="admin-page" style={adminBgStyle}>
      <div className="admin-header">
        <h1 className="admin-title">🚌 Admin Panel</h1>
        <button className="btn-logout" onClick={logout}>
          Logout
        </button>
      </div>

      {/* TABS */}
      <div className="admin-tabs">
        <button
          className={`admin-tab${activeTab === 'gallery' ? ' active' : ''}`}
          onClick={() => setActiveTab('gallery')}
        >
          🖼️ Gallery
        </button>
        <button
          className={`admin-tab${activeTab === 'siteimages' ? ' active' : ''}`}
          onClick={() => setActiveTab('siteimages')}
        >
          🎨 Site Images
        </button>
        <button
          className={`admin-tab${activeTab === 'changepassword' ? ' active' : ''}`}
          onClick={() => setActiveTab('changepassword')}
        >
          🔑 Change Password
        </button>
      </div>

      {/* ─── GALLERY TAB ─── */}
      {activeTab === 'gallery' && (
        <>
          <div className="upload-box">
            <h3>{editingId ? '✏️ Edit Image' : '📸 Add New Image'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <input
                  type="text"
                  placeholder="Image URL (or upload file below)"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                />
              </div>
              <div className="form-row">
                <input
                  type="text"
                  placeholder="Caption (optional)"
                  value={imageTitle}
                  onChange={(e) => setImageTitle(e.target.value)}
                />
                <input
                  type="number"
                  placeholder="Sort order"
                  value={imageOrder}
                  onChange={(e) => setImageOrder(e.target.value)}
                />
              </div>
              <div className="form-row">
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                />
              </div>
              {previewSrc && <img className="preview-img" src={previewSrc} alt="Preview" />}
              <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
                <button type="submit" className="upload-btn" disabled={actionLoading}>
                  {actionLoading ? 'Saving...' : editingId ? 'Update Image' : 'Upload Image'}
                </button>
                {editingId && (
                  <button type="button" className="btn-edit" onClick={resetForm}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="gallery-list">
            {images.length === 0 ? (
              <div className="empty-msg">No images yet. Upload your first photo above!</div>
            ) : (
              images.map((img) => (
                <div className="gallery-item" key={img.id}>
                  <img
                    src={img.image_url}
                    alt={img.title || ''}
                    onError={(e) => {
                      e.target.src =
                        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='80'%3E%3Crect fill='%23333' width='120' height='80'/%3E%3Ctext fill='%23999' x='50%25' y='50%25' text-anchor='middle' dy='.3em'%3EImage%3C/text%3E%3C/svg%3E";
                    }}
                  />
                  <div className="gallery-item-info">
                    <h4>{img.title || 'No caption'}</h4>
                    <p>
                      Order: {img.sort_order || 0} ·{' '}
                      <span className={img.is_active ? 'status-active' : 'status-inactive'}>
                        {img.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </p>
                  </div>
                  <div className="gallery-item-actions">
                    <button className="btn-edit" onClick={() => handleEdit(img.id)}>
                      ✏️ Edit
                    </button>
                    <button className="btn-delete" onClick={() => handleToggle(img.id)}>
                      {img.is_active ? '🙈 Hide' : '👁️ Show'}
                    </button>
                    <button className="btn-delete" onClick={() => handleDelete(img.id)}>
                      🗑️ Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* ─── SITE IMAGES TAB ─── */}
      {activeTab === 'siteimages' && (
        <div className="upload-box">
          <h3>🎨 Manage Site Images</h3>
          <p style={{ color: '#94a3b8', marginBottom: 20, fontSize: '0.9rem' }}>
            Change the images displayed on the homepage. Paste a URL or upload a file for each image.
          </p>
          {SITE_IMAGE_KEYS.map(({ key, label, placeholder }) => (
            <div className="site-image-row" key={key}>
              <div className="site-image-label">{label}</div>
              <div className="site-image-inputs">
                <input
                  type="text"
                  placeholder={placeholder}
                  value={siteImages[key] || ''}
                  onChange={(e) => handleSiteImageChange(key, e.target.value)}
                />
                <label className="site-image-upload-btn">
                  📁 Upload
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (file) handleSiteImageFile(key, file);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              {siteImages[key] && (
                <img
                  className="site-image-preview"
                  src={siteImages[key]}
                  alt={label}
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              )}
            </div>
          ))}
          <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="upload-btn" onClick={saveSiteImages} disabled={siteImagesSaving}>
              {siteImagesSaving ? 'Saving...' : '💾 Save All Images'}
            </button>
            {siteImagesSaved && <span style={{ color: '#4ade80', fontWeight: 600 }}>✓ Saved!</span>}
          </div>
        </div>
      )}

      {/* ─── CHANGE PASSWORD TAB ─── */}
      {activeTab === 'changepassword' && (
        <div className="upload-box">
          <h3>🔑 Change Password</h3>
          <p style={{ color: '#94a3b8', marginBottom: 20, fontSize: '0.9rem' }}>
            Update your admin account password.
          </p>
          <form onSubmit={handleChangePassword}>
            <div className="form-row">
              <input
                type="password"
                placeholder="Current password"
                value={cpCurrent}
                onChange={(e) => { setCpCurrent(e.target.value); setCpError(''); setCpSuccess(false); }}
              />
            </div>
            <div className="form-row">
              <input
                type="password"
                placeholder="New password (min 6 characters)"
                value={cpNew}
                onChange={(e) => { setCpNew(e.target.value); setCpError(''); setCpSuccess(false); }}
              />
              <input
                type="password"
                placeholder="Confirm new password"
                value={cpConfirm}
                onChange={(e) => { setCpConfirm(e.target.value); setCpError(''); setCpSuccess(false); }}
              />
            </div>
            {cpError && <div className="error-msg" style={{ marginBottom: 12 }}>{cpError}</div>}
            {cpSuccess && (
              <div className="success-msg" style={{ marginBottom: 12 }}>
                ✅ Password changed successfully!
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <button type="submit" className="upload-btn" disabled={cpLoading}>
                {cpLoading ? 'Changing...' : '🔑 Update Password'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
