import { useEffect, useRef, useState } from 'react'
import { Bell, BookOpen, CalendarClock, CheckCircle2, Plus, Search, Settings, Users, X, UserCog, UserPlus, LogOut, Eye } from 'lucide-react'
import shelfwiseLogo from './assets/shelfwise-logo.png'

type Status = 'available' | 'borrowed' | 'overdue' | 'returned'
type Book = { id: string | number; title: string; author: string; isbn: string; category: string; status: Status; due_date: string | null; borrower: string | null; loan_id: string | number | null; days_borrowed: number | null; overdue_days: number | null; penalty: number | null }
type Student = { id: string | number; name: string; student_number: string; course: string; year_level: string; email: string; borrowed_book: string | null; loan_id: string | number | null; loan_status: Status | null; borrowed_at: string | null; due_date: string | null; returned_at?: string | null; days_borrowed: number | null; overdue_days: number | null; penalty: number | null }
type Stats = { totalBorrowed: number; currentlyOnLoan: number; overdue: number; returned: number }
type Notification = { id: string | number; title: string; student: string; due_date: string; days_left: number }
type SessionUser = { name: string; email: string; role: 'admin' | 'librarian' }
type StaffUser = { id: string; name: string; email: string; role: 'admin' | 'librarian'; active: boolean; created_at?: string }
type BorrowingHistoryItem = { id: string; book_title: string; borrowed_at: string; due_date: string; returned_at: string | null; status: 'Borrowed' | 'Overdue' | 'Returned'; overdue_days: number; penalty: number }
const API = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')
const apiFetch = (url: string, init: RequestInit = {}) => fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${sessionStorage.getItem('library_token') || ''}` } })



function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('library_token') || '')
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)
  const [staff, setStaff] = useState<StaffUser[]>([])
  const [staffName, setStaffName] = useState('')
  const [staffEmail, setStaffEmail] = useState('')
  const [staffPassword, setStaffPassword] = useState('')
  const [staffError, setStaffError] = useState('')
  const [staffMessage, setStaffMessage] = useState('')
  const [smtpTestEmail, setSmtpTestEmail] = useState('')
  const [smtpTestStatus, setSmtpTestStatus] = useState('')
  const [smtpTesting, setSmtpTesting] = useState(false)

  async function testSmtp(event: React.FormEvent) {
    event.preventDefault()
    setSmtpTesting(true)
    setSmtpTestStatus('')
    try {
      const response = await apiFetch(`${API}/settings/test-email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: smtpTestEmail }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'SMTP test failed.')
      setSmtpTestStatus(`Test email sent to ${smtpTestEmail}. Check the inbox and spam folder.`)
    } catch (error) {
      setSmtpTestStatus(error instanceof Error ? error.message : 'Unable to send test email.')
    } finally { setSmtpTesting(false) }
  }
  async function login(event: React.FormEvent) {
    event.preventDefault()
    try {
      const response = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: loginEmail, password: loginPassword }) })
      const result = await response.json()
      if (!response.ok) throw Error(result.error || 'Login failed')
      sessionStorage.setItem('library_token', result.token)
      setToken(result.token)
      setCurrentUser(result.user)
      setLoginPassword('')
      setLoginError('')
    } catch (error) { setLoginError(error instanceof Error ? error.message : 'Unable to log in') }
  }

  useEffect(() => { if (!token) { setCurrentUser(null); return }; apiFetch(`${API}/auth/me`).then(r => { if (!r.ok) throw Error('Session expired'); return r.json() }).then(setCurrentUser).catch(() => { sessionStorage.removeItem('library_token'); setToken(''); setCurrentUser(null) }) }, [token])

  const [books, setBooks] = useState<Book[]>([])
  const [stats, setStats] = useState<Stats>({ totalBorrowed: 0, currentlyOnLoan: 0, overdue: 0, returned: 0 })
  const [students, setStudents] = useState<Student[]>([])
  const [studentSearch, setStudentSearch] = useState('')
  const [studentStatusFilter, setStudentStatusFilter] = useState<'all' | 'borrowed' | 'overdue' | 'returned' | 'not_borrowed'>('all')
  const [studentCourseFilter, setStudentCourseFilter] = useState('all')
  const [studentYearFilter, setStudentYearFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | Status>('all')
  const [loading, setLoading] = useState(true)
  const [showLoanModal, setShowLoanModal] = useState(false)
  const [showStudentModal, setShowStudentModal] = useState(false)
  const [loanStudentId, setLoanStudentId] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)
  const [historyStudent, setHistoryStudent] = useState<Student | null>(null)
  const [apiError, setApiError] = useState('')
  const [phoneAlertsEnabled, setPhoneAlertsEnabled] = useState(false)
  const [activeView, setActiveView] = useState<'overview' | 'students' | 'settings' | 'staff'>('overview')
  const reminderSentRef = useRef<string>('')

  async function enablePhoneAlerts() {
    if (!('Notification' in window)) {
      setPhoneAlertsEnabled(false)
      setApiError('This browser does not support push notifications. The library reminder system uses browser notifications or email reminders instead.')
      return
    }

    const permission = await Notification.requestPermission()
    const enabled = permission === 'granted'
    setPhoneAlertsEnabled(enabled)

    if (enabled) {
      new Notification('Shelfwise alerts enabled', {
        body: 'You will receive due-date reminders when books are near the deadline.',
      })
      setApiError('')
    } else {
      setApiError('Notifications were blocked. To get reminders, allow notifications in your browser settings or use email reminders from the library server.')
    }
  }

  async function loadData() {
    setLoading(true)
    try {
      const [bookResponse, statsResponse] = await Promise.all([apiFetch(`${API}/books?search=${encodeURIComponent(search)}&status=${filter}`), apiFetch(`${API}/stats`)]);
      if (!bookResponse.ok || !statsResponse.ok) throw new Error('Library service is unavailable.')
      setBooks(await bookResponse.json()); setStats(await statsResponse.json())
      setApiError('')
    } catch { setBooks([]); setStats({ totalBorrowed: 0, currentlyOnLoan: 0, overdue: 0, returned: 0 }); setApiError('Library service is unavailable. Set VITE_API_URL to your public API URL in Vercel.') }
    finally { setLoading(false) }
  }
  useEffect(() => { if (token) loadData() }, [search, filter, token])
  useEffect(() => { if (currentUser?.role === 'admin') loadStaff() }, [currentUser?.role])
  useEffect(() => { if (!token) return; apiFetch(`${API}/students`).then((response) => response.json()).then(setStudents).catch(() => setStudents([])) }, [token])
  useEffect(() => {
    if ('Notification' in window) {
      setPhoneAlertsEnabled(Notification.permission === 'granted')
    } else {
      setPhoneAlertsEnabled(false)
    }
  }, [])
  useEffect(() => { if (!token) return; apiFetch(`${API}/notifications`).then((response) => response.json()).then(setNotifications).catch(() => setNotifications([])) }, [books, token])
  useEffect(() => {
    if (!('Notification' in window) || Notification.permission !== 'granted' || notifications.length === 0) return

    const nextReminder = notifications[0]
    const key = `${nextReminder.id}-${nextReminder.days_left}`
    if (reminderSentRef.current === key) return

    reminderSentRef.current = key
    new Notification('Shelfwise due-date reminder', {
      body: `${nextReminder.student} has "${nextReminder.title}" due ${nextReminder.days_left === 0 ? 'today' : `in ${nextReminder.days_left} days`}.`,
    })
  }, [notifications])

  async function sendEmailReminder(student: Student) {
    if (!student.email) {
      setApiError('This student does not have an email address saved.')
      return
    }
    try {
      const response = await apiFetch(`${API}/notifications/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: student.id }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Email reminder could not be sent.')
      setApiError('')
      window.alert(`Email reminder sent to ${payload.email || student.email}.`)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Email reminder could not be sent.')
    }
  }

  async function openBorrowingHistory(student: Student) {
    setHistoryStudent(student)
  }

  async function returnLoan(loanId: string | number | null) {
    if (!loanId) return
    try {
      const response = await apiFetch(`${API}/loans/${loanId}/return`, { method: 'PATCH' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to mark this book as returned.')
      await loadData()
      const studentsResponse = await apiFetch(`${API}/students`)
      if (!studentsResponse.ok) throw new Error('The book was returned, but student records could not be refreshed. Refresh the page.')
      setStudents(await studentsResponse.json())
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to mark this book as returned.')
    }
  }
  async function clearBooks() {
    // Deletion disabled: keep function to avoid breaking any references.
    return
  }

  async function loadStaff() {
    if (currentUser?.role !== 'admin') return
    try { const response=await apiFetch(`${API}/users`); if(!response.ok) throw Error((await response.json()).error||'Unable to load staff'); setStaff(await response.json()) }
    catch(e){setStaffError(e instanceof Error?e.message:'Unable to load staff accounts.')}
  }
  async function createLibrarian(event: React.FormEvent) {
    event.preventDefault();setStaffError('');setStaffMessage('')
    try {const response=await apiFetch(`${API}/users`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:staffName,email:staffEmail,password:staffPassword})});const payload=await response.json();if(!response.ok)throw Error(payload.error||'Unable to create account');setStaffName('');setStaffEmail('');setStaffPassword('');setStaffMessage('Librarian account created successfully.');await loadStaff()}
    catch(e){setStaffError(e instanceof Error?e.message:'Unable to create librarian account.')}
  }
  async function toggleLibrarian(user: StaffUser) {
    setStaffError('');setStaffMessage('')
    try {const response=await apiFetch(`${API}/users/${user.id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:!user.active})});const payload=await response.json();if(!response.ok)throw Error(payload.error||'Unable to update account');setStaffMessage(`${user.name}'s account ${user.active?'deactivated':'activated'}.`);await loadStaff()}
    catch(e){setStaffError(e instanceof Error?e.message:'Unable to update account.')}
  }

  const recentActivity = [
    ...students.filter((student) => student.borrowed_book).slice(0, 3).map((student) => ({
      id: `student-${student.id}`,
      label: `${student.name} borrowed ${student.borrowed_book}`,
      meta: student.borrowed_at ? formatDate(student.borrowed_at) : 'Borrowing record',
      tone: 'gold'
    })),
    ...books.slice(0, 3).map((book) => ({
      id: `book-${book.id}`,
      label: `${book.title} is marked ${book.status}`,
      meta: book.author,
      tone: book.status === 'overdue' ? 'danger' : book.status === 'borrowed' ? 'gold' : 'neutral'
    }))
  ].slice(0, 5)

  const visibleStudents = students.filter((student) => {
    const query = studentSearch.trim().toLowerCase()
    const matchesSearch = !query || [student.name, student.student_number, student.course, student.email].some((value) => String(value || '').toLowerCase().includes(query))
    const matchesStatus = studentStatusFilter === 'all' || (studentStatusFilter === 'borrowed' && student.loan_status === 'borrowed') || (studentStatusFilter === 'overdue' && student.loan_status === 'overdue') || (studentStatusFilter === 'returned' && student.loan_status === 'returned') || (studentStatusFilter === 'not_borrowed' && !student.loan_id && student.loan_status !== 'returned')
    const matchesCourse = studentCourseFilter === 'all' || student.course === studentCourseFilter
    const matchesYear = studentYearFilter === 'all' || student.year_level === studentYearFilter
    return matchesSearch && matchesStatus && matchesCourse && matchesYear
  })

  const renderMainContent = () => {
    if (activeView === 'students') {
      return (
        <main className="main-content">
          <section className="page-wrap">
            <div className="page-heading">
              <div>
                <span className="eyebrow">STUDENT RECORDS</span>
                <h1>Students</h1>
                <p>Manage member profiles, contact details, and currently borrowed books.</p>
              </div>
              <div className="header-actions">
                <button className="ghost-button" onClick={() => setShowStudentModal(true)}><UserPlus size={16} /> Add student record</button>
              </div>
            </div>

            <div className="table-card">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', padding: 16, borderBottom: '1px solid rgba(212,175,55,.16)' }}>
                <label className="search-box" style={{ flex: '1 1 260px', minWidth: 220 }}><Search size={16} /><input aria-label="Search students" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Search name, library ID number, course, or email..." /></label>
                <select aria-label="Filter by borrowing status" value={studentStatusFilter} onChange={(event) => setStudentStatusFilter(event.target.value as typeof studentStatusFilter)} className="ghost-button student-filter-select"><option value="all">All statuses</option><option value="borrowed">Currently borrowing</option><option value="overdue">Overdue</option><option value="returned">Returned</option><option value="not_borrowed">No borrowing history</option></select>
                <select aria-label="Filter by course" value={studentCourseFilter} onChange={(event) => setStudentCourseFilter(event.target.value)} className="ghost-button student-filter-select"><option value="all">All courses</option>{COURSES.map(course => <option key={course} value={course}>{course}</option>)}</select>
                <select aria-label="Filter by year" value={studentYearFilter} onChange={(event) => setStudentYearFilter(event.target.value)} className="ghost-button student-filter-select"><option value="all">All years</option>{Array.from(new Set(students.map(student => student.year_level).filter(Boolean))).sort().map(year => <option key={year} value={year}>{year}</option>)}</select>
                <span className="muted" style={{ fontSize: 12 }}>{visibleStudents.length} of {students.length} students</span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Student Name</th>
                      <th>Email</th>
                      <th>Book Title</th>
                      <th>Date Borrowed</th>
                      <th>Number of Days Borrowed</th>
                      <th>Due Date</th>
                      <th>Overdue</th>
                      <th>Penalty</th>
                      <th /></tr>
                  </thead>
                  <tbody>
                    {visibleStudents.map((student) => (
                      <tr key={student.id}>
                        <td>
                          <div className="student-cell">
                            <div className="avatar">{student.name.split(' ').map((part) => part[0]).join('')}</div>
                            <div><strong>{student.name}</strong><span>{student.student_number}</span></div>
                          </div>
                        </td>
                        <td>{student.email}</td>
                        <td>{student.loan_status === 'returned' && student.borrowed_book ? <><span className="muted">Returned: </span>{student.borrowed_book}</> : student.borrowed_book || <span className="muted">No book currently borrowed</span>}</td>
                        <td>{student.borrowed_at ? formatDate(student.borrowed_at) : <span className="muted">—</span>}</td>
                        <td>{student.days_borrowed === null ? <span className="muted">—</span> : `${student.days_borrowed} ${student.days_borrowed === 1 ? 'day' : 'days'}`}</td>
                        <td>{student.due_date ? formatDate(student.due_date) : <span className="muted">—</span>}</td>
                        <td className={student.overdue_days ? 'overdue-date' : ''}>{student.overdue_days ? `${student.overdue_days} ${student.overdue_days === 1 ? 'day' : 'days'}` : <span className="muted">0 days</span>}</td>
                        <td className={student.penalty ? 'overdue-date' : ''}>{student.penalty ? `₱${student.penalty}` : <span className="muted">₱0</span>}</td>
                        <td>
                          <button type="button" className="history-icon-button" title={`View borrowing history for ${student.name}`} aria-label={`View borrowing history for ${student.name}`} onClick={() => openBorrowingHistory(student)}><Eye size={15} /></button>
                          <button className="edit-button" onClick={() => setEditingStudent(student)}>Edit</button>
                          {!student.loan_id && <button className="return-button" onClick={() => { setLoanStudentId(String(student.id)); setShowLoanModal(true) }}>{student.loan_status === 'returned' ? 'Borrow Again' : 'Borrow Book'}</button>}
                          {student.email && <button className="return-button" onClick={() => sendEmailReminder(student)}>Email</button>}
                          {student.loan_id && <button className="return-button" onClick={() => returnLoan(student.loan_id)}>Mark as Returned</button>}
                        </td>
                      </tr>
                    ))}
                    {visibleStudents.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 28 }} className="muted">No students match your search or filter.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </main>
      )
    }


    if (activeView === 'staff' && currentUser?.role === 'admin') {
      return (
        <main className="main-content"><section className="page-wrap">
          <div className="page-heading"><div><span className="eyebrow">ACCESS CONTROL</span><h1>Staff accounts</h1><p>Create and manage librarian access to the library system.</p></div></div>
          <div className="staff-layout">
            <form className="panel staff-form" onSubmit={createLibrarian}>
              <div className="panel-heading"><h3><UserPlus size={17}/> Create librarian</h3></div>
              <label>Full name<input required maxLength={100} value={staffName} onChange={e=>setStaffName(e.target.value)} placeholder="Librarian full name" /></label>
              <label>Email address<input required type="email" value={staffEmail} onChange={e=>setStaffEmail(e.target.value)} placeholder="librarian@library.edu" /></label>
              <label>Temporary password<input required type="password" minLength={12} value={staffPassword} onChange={e=>setStaffPassword(e.target.value)} placeholder="At least 12 characters" /></label>
              <p className="staff-help">New accounts are created with the Librarian role. Give the password to the staff member securely.</p>
              {staffError&&<p className="form-error" role="alert">{staffError}</p>}{staffMessage&&<p className="staff-success" role="status">{staffMessage}</p>}
              <button className="primary-button" type="submit"><UserPlus size={16}/> Create account</button>
            </form>
            <div className="panel staff-list-panel">
              <div className="panel-heading"><h3><Users size={17}/> Library staff</h3><button className="ghost-button small-button" onClick={loadStaff} type="button">Refresh</button></div>
              <div className="staff-list">
                {staff.map(user=><div className="staff-row" key={user.id}><div className="avatar small">{user.name.split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase()}</div><div className="staff-identity"><strong>{user.name}</strong><span>{user.email}</span></div><span className={`staff-status ${user.active?'active':'inactive'}`}>{user.active?'Active':'Inactive'}</span><button type="button" className="ghost-button small-button" onClick={()=>toggleLibrarian(user)}>{user.active?'Deactivate':'Activate'}</button></div>)}
                {staff.length===0&&<p className="staff-help">No librarian accounts found yet. Create the first account using the form.</p>}
              </div>
            </div>
          </div>
        </section></main>
      )
    }

    if (activeView === 'settings' && currentUser?.role === 'admin') {
      return (
        <main className="main-content">
          <section className="page-wrap">
            <div className="page-heading">
              <div>
                <span className="eyebrow">SYSTEM SETTINGS</span>
                <h1>Settings</h1>
                <p>Configure alerts, library rules, and reminder channels.</p>
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-icon gold"><Bell size={20} /></div>
                <div>
                  <span>Browser alerts</span>
                  <strong>{phoneAlertsEnabled ? 'Enabled' : 'Unavailable'}</strong>
                </div>
                <div className="stat-line" />
              </div>
              <div className="stat-card">
                <div className="stat-icon blue"><CalendarClock size={20} /></div>
                <div>
                  <span>Reminder window</span>
                  <strong>3 days</strong>
                </div>
                <div className="stat-line" />
              </div>
            </div>

            <div className="panel">
              <div className="panel-heading"><h3>Email notifications (SMTP)</h3></div>
              <p className="staff-help">SMTP credentials are stored only in the backend environment on Render. Enter a recipient below to send a test email and verify the connection.</p>
              <form className="staff-form" onSubmit={testSmtp}>
                <label>Test recipient email<input required type="email" value={smtpTestEmail} onChange={event => setSmtpTestEmail(event.target.value)} placeholder="you@example.com" /></label>
                {smtpTestStatus && <p className={smtpTestStatus.startsWith('Test email sent') ? 'staff-success' : 'form-error'} role="status">{smtpTestStatus}</p>}
                <button className="primary-button" type="submit" disabled={smtpTesting || !smtpTestEmail}>{smtpTesting ? 'Sending test email…' : 'Send test email'}</button>
              </form>
              <div className="task-list">
                <div className="task-item gold"><div className="task-dot" /><div><strong>Automatic due-date reminders</strong><small>When SMTP is configured, Shelfwise sends email reminders 7, 3, and 1 day before the due date, on the due date, and daily while overdue.</small></div></div>
              </div>
            </div>
          </section>
        </main>
      )
    }

  return (
      <main className="main-content">
        <section className="page-wrap">
          <div className="page-heading">
            <div>
              <span className="eyebrow">LIBRARY ADMIN</span>
              <h1>Borrowing and returns, in focus.</h1>
              <p>Monitor borrowed books, due dates, returns, and overdue records.</p>
            </div>
            <div className="header-actions">
              <button className="ghost-button" onClick={enablePhoneAlerts}>{phoneAlertsEnabled ? 'Alerts on' : 'Enable alerts'}</button>


            </div>
          </div>

          {apiError && <div className="api-error">{apiError}</div>}

          <div className="hero-strip">
            <button type="button" className="overview-total-card" title="Open all student records" onClick={() => { setActiveView('students'); setStudentStatusFilter('all'); setStudentCourseFilter('all'); setStudentYearFilter('all'); setStudentSearch('') }}>
              <span className="hero-label">Overview · click to view students</span>
              <h2>{stats.totalBorrowed} total borrowing records</h2>
            </button>
            <div className="hero-metrics">
              <button type="button" className="metric-chip metric-chip-button" onClick={() => { setActiveView('students'); setStudentStatusFilter('borrowed'); setStudentCourseFilter('all'); setStudentYearFilter('all'); setStudentSearch('') }}><strong>{stats.currentlyOnLoan}</strong><span>Currently borrowed</span></button>
              <button type="button" className="metric-chip metric-chip-button" onClick={() => { setActiveView('students'); setStudentStatusFilter('overdue'); setStudentCourseFilter('all'); setStudentYearFilter('all'); setStudentSearch('') }}><strong>{stats.overdue}</strong><span>Overdue</span></button>
              <button type="button" className="metric-chip metric-chip-button" onClick={() => { setActiveView('students'); setStudentStatusFilter('returned'); setStudentCourseFilter('all'); setStudentYearFilter('all'); setStudentSearch('') }}><strong>{stats.returned}</strong><span>Returned books · click to view</span></button>
            </div>
          </div>

          <div className="toolbar">
            <label className="search-box" aria-label="Search books or students">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, author, or student" />
            </label>

            <div className="filter-pills">
              {(['all', 'borrowed', 'overdue'] as Array<'all' | 'borrowed' | 'overdue'>).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`filter-pill ${filter === option ? 'active' : ''}`}
                  onClick={() => setFilter(option)}
                >
                  {option === 'all' ? 'All borrowed records' : option[0].toUpperCase() + option.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="dashboard-grid">
            <div className="panel quick-actions">
              <div className="panel-heading">
                <h3>Quick actions</h3>
              </div>
              <button className="quick-action" onClick={() => setShowLoanModal(true)}>
                <span className="quick-icon"><Plus size={16} /></span>
                <div>
                  <strong>Record borrowed book</strong>
                  <small>Record a book borrowed by a student</small>
                </div>
              </button>
              <button className="quick-action" onClick={() => setActiveView('students')}>
                <span className="quick-icon"><Users size={16} /></span>
                <div>
                  <strong>Student record</strong>
                  <small>Update member details and year</small>
                </div>
              </button>
            </div>

            <div className="panel activity-panel">
              <div className="panel-heading">
                <h3>Recent activity</h3>
              </div>
              <div className="activity-list">
                {recentActivity.map((item) => (
                  <div key={item.id} className={`activity-item ${item.tone}`}>
                    <span className="activity-dot" />
                    <div>
                      <strong>{item.label}</strong>
                      <small>{item.meta}</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>


        </section>
      </main>
    )
  }

  if (!token || !currentUser) return <main className="login-shell"><form className="login-card" onSubmit={login}><div className="login-logo-wrap"><img className="login-logo" src={shelfwiseLogo} alt="Shelfwise — Smart. Organized. Knowledge." /></div><span className="eyebrow">SHELFWISE LIBRARY</span><h1>Welcome back</h1><p>Sign in to manage library records.</p><label>Email address<input type="email" required value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="you@library.edu" /></label><label>Password<input type="password" required value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="Enter your password" /></label>{loginError && <p role="alert" className="form-error">{loginError}</p>}<button className="primary-button login-submit" type="submit">Sign in</button></form></main>
  return <div className="app-shell">
    <button type="button" className="signout-button" onClick={() => { sessionStorage.removeItem('library_token'); setToken(''); setCurrentUser(null); setBooks([]); setStudents([]) }}><LogOut size={14}/> Sign out</button>
    <aside className="dashboard-sidebar">
      <div className="brand">
        <img className="sidebar-logo" src={shelfwiseLogo} alt="" />
        <span className="brand-name">Shelfwise</span>
      </div>

      <div className="workspace-label">BORROWING MONITOR</div>

      <nav className="sidebar-nav" aria-label="Sidebar navigation">
        <button className={`nav-item ${activeView === 'overview' ? 'active' : ''}`} onClick={() => setActiveView('overview')}>
          <BookOpen size={16} /><span>Overview</span>
        </button>
        <button className={`nav-item ${activeView === 'students' ? 'active' : ''}`} onClick={() => setActiveView('students')}>
          <Users size={16} /><span>Students</span>
        </button>
        {currentUser.role === 'admin' && <button className={`nav-item ${activeView === 'staff' ? 'active' : ''}`} onClick={() => { setActiveView('staff'); loadStaff() }}>
          <UserCog size={16} /><span>Staff accounts</span>
        </button>}
        {currentUser.role === 'admin' && <button className={`nav-item ${activeView === 'settings' ? 'active' : ''}`} onClick={() => setActiveView('settings')}>
          <Settings size={16} /><span>Settings</span>
        </button>}
      </nav>

      <div className="sidebar-bottom">
        <div className="admin-card">
          <div className="avatar small">{currentUser.name.split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase()}</div>
          <div>
            <strong>{currentUser.name}</strong>
            <span>{currentUser.role === 'admin' ? 'Administrator' : 'Librarian'}</span>
          </div>
          <Settings size={16} />
        </div>
      </div>
    </aside>

    {renderMainContent()}

    {showStudentModal && <AddStudentModal onClose={() => setShowStudentModal(false)} onSaved={() => { setShowStudentModal(false); apiFetch(`${API}/students`).then((response) => response.json()).then(setStudents) }} />}
    {showLoanModal && <LoanModal students={students} initialStudentId={loanStudentId} onClose={() => { setShowLoanModal(false); setLoanStudentId(null) }} onSaved={() => { setShowLoanModal(false); setLoanStudentId(null); loadData(); apiFetch(`${API}/students`).then((response) => response.json()).then(setStudents) }} />}
    {editingStudent && <EditStudentModal student={editingStudent} onClose={() => setEditingStudent(null)} onSaved={() => { setEditingStudent(null); apiFetch(`${API}/students`).then((response) => response.json()).then(setStudents) }} />}
    {historyStudent && <BorrowingHistoryModal student={historyStudent} onClose={() => setHistoryStudent(null)} />}
  </div>
}

function StatCard({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: string }) { return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div><span>{label}</span><strong>{value}</strong></div><div className="stat-line" /></div> }
function StatusBadge({ status }: { status: Status }) { return <span className={`status ${status}`}><span />{status[0].toUpperCase() + status.slice(1)}</span> }
function formatDate(date: string) { return new Date(`${date.length === 10 ? `${date}T12:00:00` : date}`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
const COURSES = ['BSIT', 'BSHM', 'BSCRIM', 'BSBA', 'BSED', 'BEED']

function LoanModal({ students, initialStudentId, onClose, onSaved }: { students: Student[]; initialStudentId: string | null; onClose: () => void; onSaved: () => void }) {
  const availableStudents = students.filter(student => !student.loan_id)
  const [bookTitle, setBookTitle] = useState('')
  const [studentChoice, setStudentChoice] = useState(() => {
    const preselected = availableStudents.find(student => String(student.id) === initialStudentId)
    return preselected ? String(preselected.id) : availableStudents[0] ? String(availableStudents[0].id) : ''
  })
  const [dueDate, setDueDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().slice(0, 10) })
  const [error, setError] = useState('')
  const selectedStudent = availableStudents.find(student => String(student.id) === studentChoice)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!selectedStudent) { setError('Please add a student record first, then select that student here.'); return }
    try {
      const payload = { book_title: bookTitle, student_id: selectedStudent.id, student_name: selectedStudent.name, course: selectedStudent.course, year_level: selectedStudent.year_level, email: selectedStudent.email, due_date: dueDate }
      const response = await apiFetch(`${API}/loans`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!response.ok) { setError((await response.json()).error); return }
      onSaved()
    } catch { setError('Cannot reach the library service. Check the deployed API URL.') }
  }

  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={submit}>
    <div className="modal-heading"><div><span className="eyebrow">BORROWING RECORD</span><h2>Record borrowed book</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={19} /></button></div>
    <label>Book received<input required value={bookTitle} onChange={event => setBookTitle(event.target.value)} placeholder="Type the book title checked by admin" /></label>
    <label>Student<select required value={studentChoice} onChange={event => { setStudentChoice(event.target.value); setError('') }}><option value="">Select an existing student</option>{availableStudents.map(student => <option key={student.id} value={String(student.id)}>{student.name} — Library ID: {student.student_number}</option>)}</select></label>
    {selectedStudent ? <div style={{ padding: 12, borderRadius: 10, background: 'rgba(212,175,55,.08)', border: '1px solid rgba(212,175,55,.2)', fontSize: 13 }}><strong>{selectedStudent.name}</strong><div>Library ID: {selectedStudent.student_number} · {selectedStudent.course} · {selectedStudent.year_level}</div><div>{selectedStudent.email}</div></div> : <p className="history-message">{students.length ? 'No students are currently available to borrow another book.' : 'No student records yet. Add a student record first.'}</p>}
    <label>Return by<input required type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>
    {error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={!selectedStudent}><BookOpen size={17} />Save borrowing record</button></div>
  </form></div>
}

function AddStudentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', student_number: '', course: 'BSIT', year_level: '1st year', email: '' })
  const [error, setError] = useState('')
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    try {
      const response = await apiFetch(`${API}/students`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to add student record.')
      onSaved()
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to add student record.') }
  }
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={submit}>
    <div className="modal-heading"><div><span className="eyebrow">STUDENT RECORD</span><h2>Add student record</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={19} /></button></div>
    <label>Student Library ID Number<input required value={form.student_number} onChange={event => setForm({ ...form, student_number: event.target.value.toUpperCase() })} placeholder="Enter unique library ID number" /></label>
    <label>Student name<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Type the student's full name" /></label>
    <label>Gmail / email<input required type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} placeholder="student@gmail.com" /></label>
    <label>Course / program<select required value={form.course} onChange={event => setForm({ ...form, course: event.target.value })}>{COURSES.map(course => <option key={course} value={course}>{course}</option>)}</select></label>
    <label>Year<select required value={form.year_level} onChange={event => setForm({ ...form, year_level: event.target.value })}><option>1st year</option><option>2nd year</option><option>3rd year</option><option>4th year</option></select></label>
    {error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><UserPlus size={16} />Save student record</button></div>
  </form></div>
}

function BorrowingHistoryModal({ student, onClose }: { student: Student; onClose: () => void }) {
  const [history, setHistory] = useState<BorrowingHistoryItem[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoadingHistory(true)
    setError('')
    apiFetch(`${API}/students/${student.id}/borrowing-history`)
      .then(async response => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || 'Unable to load borrowing history.')
        return payload
      })
      .then(payload => { if (active) setHistory(Array.isArray(payload) ? payload : []) })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Unable to load borrowing history.') })
      .finally(() => { if (active) setLoadingHistory(false) })
    return () => { active = false }
  }, [student.id])

  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="modal history-modal" role="dialog" aria-modal="true" aria-labelledby="borrowing-history-title">
      <div className="modal-heading">
        <div><span className="eyebrow">STUDENT RECORD</span><h2 id="borrowing-history-title">Borrowing History</h2><p className="history-student-subtitle">{student.name} · Library ID: {student.student_number}</p></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close borrowing history"><X size={19} /></button>
      </div>
      {loadingHistory ? <p className="history-message">Loading borrowing history...</p>
        : error ? <p className="form-error" role="alert">{error}</p>
        : history.length === 0 ? <p className="history-message">No borrowing history found for this student.</p>
        : <div className="history-table-wrap"><table className="history-table"><thead><tr><th>Book</th><th>Borrowed</th><th>Due date</th><th>Returned</th><th>Status</th></tr></thead><tbody>
          {history.map(item => <tr key={item.id}><td className="history-book-title">{item.book_title}</td><td>{formatDate(item.borrowed_at)}</td><td>{formatDate(item.due_date)}</td><td>{item.returned_at ? formatDate(item.returned_at) : '—'}</td><td><span className={`history-status ${item.status.toLowerCase()}`}>{item.status}</span>{item.status === 'Overdue' && item.overdue_days > 0 ? <small className="history-penalty">{item.overdue_days} day(s) overdue · ₱{item.penalty}</small> : null}</td></tr>)}
        </tbody></table></div>}
      <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Close</button></div>
    </section>
  </div>
}

function EditStudentModal({ student, onClose, onSaved }: { student: Student; onClose: () => void; onSaved: () => void }) { const [form, setForm] = useState({ name: student.name, course: student.course, year_level: student.year_level, email: student.email }); const [error, setError] = useState(''); async function submit(event: React.FormEvent) { event.preventDefault(); const response = await apiFetch(`${API}/students/${student.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }); if (!response.ok) { setError((await response.json()).error); return } onSaved() } return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={submit}><div className="modal-heading"><div><span className="eyebrow">STUDENT RECORD</span><h2>Edit student</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={19} /></button></div><label>Name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Course / program<select required value={form.course} onChange={(event) => setForm({ ...form, course: event.target.value })}>{COURSES.map(course => <option key={course} value={course}>{course}</option>)}</select></label><label>Year<select required value={form.year_level} onChange={(event) => setForm({ ...form, year_level: event.target.value })}><option>1st year</option><option>2nd year</option><option>3rd year</option><option>4th year</option></select></label><label>Email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Save changes</button></div></form></div> }

export default App
