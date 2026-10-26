import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { PerfumeDatabase } from './components/PerfumeDatabase';
import { AddPerfume } from './components/AddPerfume';
import { MixingCalculator } from './components/MixingCalculator';
import { SimilarPerfume } from './components/SimilarPerfume';
import { MixingHistory } from './components/MixingHistory';
import { SalesTeam } from './components/SalesTeam';
import { Reports } from './components/Reports';
import { Settings } from './components/Settings';
import { TeamChat } from './components/TeamChat';
import { GlobalChatNotifications, ChatToastItem } from './components/GlobalChatNotifications';
import { PdfImportModal } from './components/PdfImportModal';
import { PerfumeDetailModal } from './components/PerfumeDetailModal';
import {
  getPerfumes,
  savePerfumes,
  addPerfume,
  updatePerfume,
  deletePerfume,
  getHistory,
  saveFormula,
  deleteFormula,
  clearHistory,
  getSettings,
  saveSettings,
  resetSettings,
  restoreDefaultPerfumes,
  getSalesMen,
  saveSalesMen,
  addSalesMan,
  updateSalesMan,
  deleteSalesMan,
  initStorageSync,
} from './services/storage';
import { fetchUnreadCount, subscribeToChat } from './services/chat';
import { initAuth, getCurrentUser } from './services/auth';
import { playNotificationSound } from './services/sound';
import { Perfume, MixingFormula, AppSettings, PageId, ExtractedPerfume, SalesMan } from './types';

export function App() {
  // Navigation State
  const [currentPage, setCurrentPage] = useState<PageId>('dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState<number>(0);

  // Global In-App Notifications Queue
  const [notifications, setNotifications] = useState<ChatToastItem[]>([]);
  const shownMessageIdsRef = useRef<Set<string>>(new Set());
  const sessionStartTimeRef = useRef<number>(Date.now());
  const currentPageRef = useRef<PageId>(currentPage);
  const currentUserRef = useRef(getCurrentUser());

  // App Data States (Persisted in LocalStorage + Server File System)
  const [perfumes, setPerfumes] = useState<Perfume[]>([]);
  const [history, setHistory] = useState<MixingFormula[]>([]);
  const [salesmen, setSalesmen] = useState<SalesMan[]>([]);
  const [settings, setSettings] = useState<AppSettings>(getSettings());
  const settingsRef = useRef<AppSettings>(settings);

  // Keep live refs updated for callback access
  currentPageRef.current = currentPage;
  settingsRef.current = settings;

  // Contextual Action States
  const [preselectedPerfume, setPreselectedPerfume] = useState<Perfume | null>(null);
  const [preselectedFormula, setPreselectedFormula] = useState<MixingFormula | null>(null);
  const [preselectedSalesManId, setPreselectedSalesManId] = useState<string | undefined>(undefined);
  const [editingPerfume, setEditingPerfume] = useState<Perfume | null>(null);
  const [viewingDetailPerfume, setViewingDetailPerfume] = useState<Perfume | null>(null);

  // Modals
  const [isPdfImportOpen, setIsPdfImportOpen] = useState(false);

  // Initial Load from LocalStorage + Background Server Sync + Real-time Listeners
  useEffect(() => {
    // 1. Initial immediate local load
    setPerfumes(getPerfumes());
    setHistory(getHistory());
    setSalesmen(getSalesMen());
    setSettings(getSettings());

    // 2. Real-time storage change listeners
    const handleHistoryUpdate = (e: any) => {
      if (e.detail && Array.isArray(e.detail)) {
        setHistory(e.detail);
      }
    };
    const handlePerfumesUpdate = (e: any) => {
      if (e.detail && Array.isArray(e.detail)) {
        setPerfumes(e.detail);
      }
    };
    const handleSalesmenUpdate = (e: any) => {
      if (e.detail && Array.isArray(e.detail)) {
        setSalesmen(e.detail);
      }
    };
    const handleSettingsUpdate = (e: any) => {
      if (e.detail) {
        setSettings(e.detail);
      }
    };

    window.addEventListener('perfume_history_updated', handleHistoryUpdate);
    window.addEventListener('perfume_db_updated', handlePerfumesUpdate);
    window.addEventListener('perfume_salesmen_updated', handleSalesmenUpdate);
    window.addEventListener('perfume_settings_updated', handleSettingsUpdate);

    // 3. Background server reconciliation for persistent storage across reloads/restarts
    initStorageSync(
      (serverHistory) => setHistory(serverHistory),
      (serverPerfumes) => setPerfumes(serverPerfumes),
      (serverSettings) => setSettings(serverSettings),
      (serverSalesmen) => setSalesmen(serverSalesmen)
    );

    // 4. Initialize auth session & chat unread badge count
    initAuth().then((user) => {
      if (user) currentUserRef.current = user;
      fetchUnreadCount().then((count) => setUnreadChatCount(count));
    });

    // 5. Global Real-time Chat Subscription at the Root Layout Level (active across every page)
    const unsubscribeChat = subscribeToChat((event) => {
      if (event.type === 'new_message' && event.message) {
        const msg = event.message;

        // Smart Rule 1: Prevent duplicate notification triggers
        if (shownMessageIdsRef.current.has(msg.id)) return;
        shownMessageIdsRef.current.add(msg.id);

        const activeUser = currentUserRef.current || getCurrentUser();
        // Smart Rule 2: Do not show notification for own message
        if (activeUser && msg.senderId === activeUser.id) {
          return;
        }

        // Smart Rule 3: Do not notify for old messages loaded on app boot
        const msgTime = new Date(msg.createdAt).getTime();
        if (msgTime < sessionStartTimeRef.current - 5000) {
          return;
        }

        // Update global unread badge counter if not on chat page
        if (currentPageRef.current !== 'chat') {
          fetchUnreadCount().then((count) => setUnreadChatCount(count));
        }

        // Smart Rule 4: If user is actively on Team Chat, conversation is already live in front of them
        if (currentPageRef.current === 'chat') {
          return;
        }

        // Smart Rule 5: Subtle luxury notification chime (if enabled in Atelier Settings)
        if (settingsRef.current.chatSoundEnabled !== false) {
          playNotificationSound();
        }

        // Smart Rule 6: Attention-grabbing pop-up notification toast (if enabled in Atelier Settings)
        if (settingsRef.current.chatToastsEnabled !== false) {
          setNotifications((prev) => [
            {
              id: `toast_${msg.id}_${Date.now()}`,
              message: msg,
              timestamp: Date.now(),
            },
            ...prev.slice(0, 3), // Stack up to 4 notifications cleanly without overlap
          ]);
        }
      }
    });

    const handleAuthChanged = (e: any) => {
      currentUserRef.current = e.detail?.user || getCurrentUser();
      fetchUnreadCount().then((count) => setUnreadChatCount(count));
    };

    const handleChatRead = () => {
      setUnreadChatCount(0);
    };

    window.addEventListener('kprime_auth_changed', handleAuthChanged);
    window.addEventListener('kprime_chat_read', handleChatRead);

    return () => {
      unsubscribeChat();
      window.removeEventListener('perfume_history_updated', handleHistoryUpdate);
      window.removeEventListener('perfume_db_updated', handlePerfumesUpdate);
      window.removeEventListener('perfume_salesmen_updated', handleSalesmenUpdate);
      window.removeEventListener('perfume_settings_updated', handleSettingsUpdate);
      window.removeEventListener('kprime_auth_changed', handleAuthChanged);
      window.removeEventListener('kprime_chat_read', handleChatRead);
    };
  }, []);

  // Handlers for In-App Notifications
  const handleDismissNotification = (id: string) => {
    setNotifications((prev) => prev.filter((item) => item.id !== id));
  };

  const handleOpenChatFromNotification = (_messageId?: string) => {
    setNotifications([]);
    handleNavigate('chat');
  };

  // Handlers for Navigation & Context Setup
  const handleNavigate = (page: PageId) => {
    setCurrentPage(page);
    setMobileSidebarOpen(false);
    if (page === 'chat') {
      setUnreadChatCount(0);
      setNotifications([]); // Clear active popups when navigating into chat
    }
    // Reset specific target states if manually navigating
    if (page !== 'calculator') {
      setPreselectedPerfume(null);
      setPreselectedFormula(null);
      setPreselectedSalesManId(undefined);
    }
    if (page !== 'add-perfume') {
      setEditingPerfume(null);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Launch Calculator with specific perfume
  const handleSelectPerfumeToMix = (perfume: Perfume) => {
    setPreselectedPerfume(perfume);
    setPreselectedFormula(null);
    setCurrentPage('calculator');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Launch Calculator with specific Sales Man
  const handleMixWithSalesMan = (salesManId: string) => {
    setPreselectedSalesManId(salesManId);
    setPreselectedFormula(null);
    setPreselectedPerfume(null);
    setCurrentPage('calculator');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Launch Calculator repeating a formula from History
  const handleRepeatFormula = (formula: MixingFormula) => {
    setPreselectedFormula(formula);
    setPreselectedPerfume(null);
    if (formula.salesManId) {
      setPreselectedSalesManId(formula.salesManId);
    }
    setCurrentPage('calculator');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Launch Edit Perfume form
  const handleEditPerfume = (perfume: Perfume) => {
    setEditingPerfume(perfume);
    setCurrentPage('add-perfume');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Sales Staff Operations
  const handleAddSalesMan = (data: Omit<SalesMan, 'id' | 'createdAt'>) => {
    const created = addSalesMan(data);
    setSalesmen(getSalesMen());
    return created;
  };

  const handleUpdateSalesMan = (id: string, updates: Partial<Omit<SalesMan, 'id' | 'createdAt'>>) => {
    const updated = updateSalesMan(id, updates);
    setSalesmen(getSalesMen());
    return updated;
  };

  const handleDeleteSalesMan = (id: string) => {
    const ok = deleteSalesMan(id);
    if (ok) {
      setSalesmen(getSalesMen());
    }
    return ok;
  };

  // Database operations
  const handleSaveNewPerfume = (data: Omit<Perfume, 'id' | 'createdAt' | 'updatedAt'>) => {
    const result = addPerfume(data);
    if (result.success && result.perfume) {
      setPerfumes(getPerfumes());
    }
    return result;
  };

  const handleUpdateExistingPerfume = (id: string, updates: Partial<Omit<Perfume, 'id' | 'createdAt'>>) => {
    const result = updatePerfume(id, updates);
    if (result.success && result.perfume) {
      setPerfumes(getPerfumes());
      if (editingPerfume?.id === id) {
        setEditingPerfume(null);
      }
    }
    return result;
  };

  const handleDeletePerfume = (id: string) => {
    const success = deletePerfume(id);
    if (success) {
      setPerfumes(getPerfumes());
    }
  };

  // Mixing History operations
  const handleSaveFormula = (formulaData: Omit<MixingFormula, 'id' | 'createdAt'>) => {
    const saved = saveFormula(formulaData);
    setHistory(getHistory());
    return saved;
  };

  const handleDeleteFormula = (id: string) => {
    const success = deleteFormula(id);
    if (success) {
      setHistory(getHistory());
    }
  };

  const handleClearHistory = () => {
    clearHistory();
    setHistory([]);
  };

  // Settings operations
  const handleSaveSettings = (newSettings: AppSettings) => {
    saveSettings(newSettings);
    setSettings(newSettings);
  };

  const handleResetSettings = () => {
    const reset = resetSettings();
    setSettings(reset);
  };

  const handleRestoreDefaultPerfumes = () => {
    const restored = restoreDefaultPerfumes();
    setPerfumes(restored);
  };

  // PDF Import completion handler
  const handlePdfImportComplete = (extracted: ExtractedPerfume[], mode: 'merge' | 'replace') => {
    const now = new Date().toISOString();
    const newPerfumeList: Perfume[] = extracted.map((item, index) => {
      const code = item.code?.trim() || `PERF-${(perfumes.length + index + 1).toString().padStart(3, '0')}`;
      return {
        id: `perf_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 5)}`,
        code,
        name: item.name.trim(),
        brand: item.brand?.trim(),
        fragrance: item.fragrance?.trim() || 'General Fragrance',
        category: item.category?.trim() || 'Unisex',
        notes: item.notes?.trim() || '',
        accords: item.accords?.trim(),
        description: item.description?.trim(),
        createdAt: now,
        updatedAt: now,
      };
    });

    let finalPerfumes: Perfume[];
    if (mode === 'replace') {
      finalPerfumes = newPerfumeList;
    } else {
      // Merge mode: append or update matching codes
      const existingMap = new Map(perfumes.map((p) => [p.code.toLowerCase(), p]));
      newPerfumeList.forEach((newItem) => {
        const key = newItem.code.toLowerCase();
        if (existingMap.has(key)) {
          const old = existingMap.get(key)!;
          existingMap.set(key, { ...old, ...newItem, id: old.id, updatedAt: now });
        } else {
          existingMap.set(key, newItem);
        }
      });
      finalPerfumes = Array.from(existingMap.values());
    }

    savePerfumes(finalPerfumes);
    setPerfumes(finalPerfumes);
    setCurrentPage('database');
  };

  // Full backup import
  const handleImportBackup = (
    importedPerfumes: Perfume[],
    importedHistory: MixingFormula[],
    importedSettings?: AppSettings,
    importedSalesMen?: SalesMan[]
  ) => {
    savePerfumes(importedPerfumes);
    setPerfumes(importedPerfumes);
    if (importedHistory) {
      localStorage.setItem('kprime_mixing_history_v1', JSON.stringify(importedHistory));
      setHistory(importedHistory);
    }
    if (importedSalesMen) {
      saveSalesMen(importedSalesMen);
      setSalesmen(importedSalesMen);
    }
    if (importedSettings) {
      saveSettings(importedSettings);
      setSettings(importedSettings);
    }
  };

  return (
    <div className="flex min-h-screen bg-[#faf9f6] text-stone-900 font-sans antialiased selection:bg-emerald-200 selection:text-emerald-950 relative">
      {/* Global In-App Team Chat Notification Pop-ups */}
      <GlobalChatNotifications
        notifications={notifications}
        onDismiss={handleDismissNotification}
        onOpenChat={handleOpenChatFromNotification}
        unreadCount={unreadChatCount}
      />

      {/* Left Sidebar Navigation */}
      <Sidebar
        currentPage={currentPage}
        onNavigate={handleNavigate}
        perfumeCount={perfumes.length}
        historyCount={history.length}
        salesmenCount={salesmen.length}
        unreadChatCount={unreadChatCount}
        settings={settings}
        onOpenPdfImport={() => setIsPdfImportOpen(true)}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      {/* Main App Content Area */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
        {/* Sticky Top Header Bar */}
        <Header
          currentPage={currentPage}
          onNavigate={handleNavigate}
          onOpenPdfImport={() => setIsPdfImportOpen(true)}
          onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
          perfumeCount={perfumes.length}
          unreadChatCount={unreadChatCount}
        />

        {/* Page Content Rendering */}
        <main className="flex-1 pb-16">
          {currentPage === 'dashboard' && (
            <Dashboard
              perfumes={perfumes}
              history={history}
              settings={settings}
              onNavigate={handleNavigate}
              onRepeatFormula={handleRepeatFormula}
              onOpenPdfImport={() => setIsPdfImportOpen(true)}
              onSelectPerfumeToMix={handleSelectPerfumeToMix}
            />
          )}

          {currentPage === 'database' && (
            <PerfumeDatabase
              perfumes={perfumes}
              onSelectPerfumeToMix={handleSelectPerfumeToMix}
              onViewPerfumeDetails={(p) => setViewingDetailPerfume(p)}
              onEditPerfume={handleEditPerfume}
              onDeletePerfume={handleDeletePerfume}
              onNavigateToAddPerfume={() => {
                setEditingPerfume(null);
                handleNavigate('add-perfume');
              }}
              onOpenPdfImport={() => setIsPdfImportOpen(true)}
            />
          )}

          {currentPage === 'add-perfume' && (
            <AddPerfume
              perfumes={perfumes}
              editingPerfume={editingPerfume}
              onSavePerfume={handleSaveNewPerfume}
              onUpdatePerfume={handleUpdateExistingPerfume}
              onCancel={() => handleNavigate('database')}
              onNavigateToCalculator={handleSelectPerfumeToMix}
            />
          )}

          {currentPage === 'calculator' && (
            <MixingCalculator
              perfumes={perfumes}
              salesmen={salesmen}
              settings={settings}
              preselectedPerfume={preselectedPerfume}
              preselectedFormula={preselectedFormula}
              preselectedSalesManId={preselectedSalesManId}
              onSaveFormula={handleSaveFormula}
              onNavigateToHistory={() => handleNavigate('history')}
              onNavigateToSettings={() => handleNavigate('settings')}
            />
          )}

          {currentPage === 'similar-perfume' && (
            <SimilarPerfume
              perfumes={perfumes}
              onSelectPerfumeToMix={handleSelectPerfumeToMix}
              onViewPerfumeDetail={(p) => setViewingDetailPerfume(p)}
              onNavigate={handleNavigate}
            />
          )}

          {currentPage === 'chat' && (
            <TeamChat />
          )}

          {currentPage === 'history' && (
            <MixingHistory
              history={history}
              salesmen={salesmen}
              onRepeatFormula={handleRepeatFormula}
              onDeleteFormula={handleDeleteFormula}
              onClearHistory={handleClearHistory}
              onNavigateToCalculator={() => handleNavigate('calculator')}
            />
          )}

          {currentPage === 'reports' && (
            <Reports
              salesmen={salesmen}
              history={history}
              onNavigateToCalculator={handleMixWithSalesMan}
              onNavigateToStaff={() => handleNavigate('sales-team')}
            />
          )}

          {currentPage === 'sales-team' && (
            <SalesTeam
              salesmen={salesmen}
              history={history}
              onAddSalesMan={handleAddSalesMan}
              onUpdateSalesMan={handleUpdateSalesMan}
              onDeleteSalesMan={handleDeleteSalesMan}
              onNavigateToMix={handleMixWithSalesMan}
              onNavigateToReport={() => handleNavigate('reports')}
            />
          )}

          {currentPage === 'settings' && (
            <Settings
              settings={settings}
              perfumes={perfumes}
              history={history}
              salesmen={salesmen}
              onSaveSettings={handleSaveSettings}
              onResetSettings={handleResetSettings}
              onRestoreDefaultPerfumes={handleRestoreDefaultPerfumes}
              onImportBackup={handleImportBackup}
            />
          )}
        </main>
      </div>

      {/* PDF Import Modal */}
      <PdfImportModal
        isOpen={isPdfImportOpen}
        onClose={() => setIsPdfImportOpen(false)}
        onImportComplete={handlePdfImportComplete}
        currentPerfumeCount={perfumes.length}
      />

      {/* Perfume Full Details Modal */}
      <PerfumeDetailModal
        perfume={viewingDetailPerfume}
        onClose={() => setViewingDetailPerfume(null)}
        onSelectToMix={handleSelectPerfumeToMix}
        onEdit={handleEditPerfume}
      />
    </div>
  );
}

export default App;

