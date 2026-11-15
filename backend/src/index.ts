import 'dotenv/config'

import express, { type Request, type Response, type NextFunction } from 'express'

import cors from 'cors'

import mongoose, { Schema, Types } from 'mongoose'

import nodemailer from 'nodemailer'

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'



const app = express()

app.disable('x-powered-by')

app.set('trust proxy', 1)

app.use(cors({ origin: (process.env.FRONTEND_ORIGIN || 'http\://localhost:5173').split(',').map(v => v.trim()), methods: ['GET','POST','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }))

app.use(express.json({ limit: '32kb' }))



const mongoUri = process.env.MONGODB_URI?.trim()

const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase()

const adminPassword = process.env.ADMIN_PASSWORD

const adminName = process.env.ADMIN_NAME?.trim() || 'Library Administrator'

const sessionSecret = process.env.SESSION_SECRET

if (!mongoUri) throw new Error('MONGODB_URI is required. Add your MongoDB Atlas connection string to backend/.env.')

if (!adminEmail || !adminPassword || adminPassword.length < 12 || !sessionSecret || sessionSecret.length < 32) throw new Error('Configure ADMIN_EMAIL, ADMIN_PASSWORD (12+ characters), and SESSION_SECRET (32+ characters).')



const PENALTY_GRACE_DAYS = 15

const PENALTY_PER_DAY = 5

const dateOnly = (date = new Date()) => {

  const y = date.getFullYear(), m = String(date.getMonth()+1).padStart(2,'0'), d = String(date.getDate()).padStart(2,'0')

  return `${y}-${m}-${d}`

}

const daysBetween = (from: string, to: string) => Math.max(0, Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000))

const validDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0,10) === v

const required = (v: unknown, max = 255): v is string => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max

const asId = (v: unknown) => Types.ObjectId.isValid(String(v))

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const idOf = (doc: any) => String(doc._id)



const bookSchema = new Schema({ title:{type:String,required:true,trim:true}, author:{type:String,required:true,trim:true}, isbn:{type:String,required:true,unique:true,trim:true}, category:{type:String,required:true,trim:true}, created_at:{type:Date,default:Date.now} }, { versionKey:false })

const studentSchema = new Schema({ name:{type:String,required:true,trim:true}, student_number:{type:String,required:true,unique:true,trim:true,uppercase:true},  course:{type:String,required:true}, year_level:{type:String,default:'1st year'}, email:{type:String,required:true,lowercase:true,trim:true}, created_at:{type:Date,default:Date.now} }, { versionKey:false })

const userSchema = new Schema({ name:{type:String,required:true,trim:true}, email:{type:String,required:true,unique:true,lowercase:true,trim:true}, role:{type:String,enum:['admin','librarian'],required:true}, password_hash:{type:String,required:true,select:false}, password_salt:{type:String,required:true,select:false}, active:{type:Boolean,default:true}, created_at:{type:Date,default:Date.now} }, { versionKey:false })

const loanSchema = new Schema({ book_id:{type:Schema.Types.ObjectId,ref:'Book',required:true}, student_id:{type:Schema.Types.ObjectId,ref:'Student',required:true}, borrowed_at:{type:Date,default:Date.now}, due_date:{type:String,required:true}, returned_at:{type:Date,default:null}, last_reminder_sent_at:{type:Date,default:null}, last_email_reminder_key:{type:String,default:null} }, { versionKey:false })

loanSchema.index({ book_id:1 }, { unique:true, partialFilterExpression:{ returned_at:null } })

loanSchema.index({ student_id:1 }, { unique:true, partialFilterExpression:{ returned_at:null } })

loanSchema.index({ returned_at:1, due_date:1 })

const Book = mongoose.model('Book', bookSchema)

const Student = mongoose.model('Student', studentSchema)

const Loan = mongoose.model('Loan', loanSchema)

const User = mongoose.model('User', userSchema)



const sign = (payload:string) => createHmac('sha256', sessionSecret).update(payload).digest('base64url')

const hashPassword = (password:string, salt:string) => scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex')

const safeEqual = (a:string,b:string) => { const aa=Buffer.from(a,'hex'), bb=Buffer.from(b,'hex'); return aa.length===bb.length && timingSafeEqual(aa,bb) }

const loginAttempts = new Map<string,{count:number;until:number}>()

type AuthInfo = { userId:string; role:'admin'|'librarian'; name:string; email:string }

type AuthRequest = Request & { auth?: AuthInfo }

function issueToken(user:AuthInfo) {

  const payload=Buffer.from(JSON.stringify({...user,exp:Date.now()+8*60*60_000})).toString('base64url')

  return `${payload}.${sign(payload)}`

}

app.post('/api/auth/login', async (req:Request,res:Response) => {

  const ip=req.ip||'unknown', attempt=loginAttempts.get(ip)

  if(attempt && attempt.until>Date.now() && attempt.count>=5) return res.status(429).json({error:'Too many attempts. Try again in 15 minutes.'})

  const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():''

  const password=typeof req.body?.password==='string'?req.body.password:''

  try {

    const user=await User.findOne({email}).select('+password_hash +password_salt')

    const valid=!!user && user.active && password.length<=1024 && safeEqual(hashPassword(password,user.password_salt),user.password_hash)

    if(!valid){const count=attempt?.until&&attempt.until>Date.now()?attempt.count:0;loginAttempts.set(ip,{count:count+1,until:Date.now()+15*60_000});return res.status(401).json({error:'Invalid email or password.'})}

    loginAttempts.delete(ip)

    const auth={userId:String(user._id),role:user.role as 'admin'|'librarian',name:user.name,email:user.email}

    res.json({token:issueToken(auth),user:{name:auth.name,email:auth.email,role:auth.role}})

  } catch { res.status(500).json({error:'Unable to sign in. Please try again.'}) }

})

app.get('/api/health', (_req,res) => res.json({ok:true,database:mongoose.connection.readyState===1?'connected':'disconnected'}))

app.use('/api', async (req:AuthRequest,res:Response,next:NextFunction) => {

  if(req.path==='/health'||req.path==='/auth/login') return next()

  const token=/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1]

  if(!token) return res.status(401).json({error:'Please sign in to continue.'})

  const [payload,signature,extra]=token.split('.')

  if(!payload||!signature||extra) return res.status(401).json({error:'Invalid session.'})

  const expected=sign(payload), a=Buffer.from(signature), b=Buffer.from(expected)

  if(a.length!==b.length||!timingSafeEqual(a,b)) return res.status(401).json({error:'Invalid session.'})

  try {

    const data=JSON.parse(Buffer.from(payload,'base64url').toString()) as AuthInfo & {exp:number}

    if(!data.userId||!['admin','librarian'].includes(data.role)||!Number.isFinite(data.exp)||data.exp<Date.now()) throw Error('expired')

    const user=await User.findById(data.userId).select('_id name email role active').lean()

    if(!user||!user.active) return res.status(401).json({error:'This account is inactive. Contact an administrator.'})

    req.auth={userId:String(user._id),role:user.role as 'admin'|'librarian',name:user.name,email:user.email}

    next()

  } catch { return res.status(401).json({error:'Session expired. Please sign in again.'}) }

})

const requireAdmin=(req:Request,res:Response,next:NextFunction)=>{

  if((req as AuthRequest).auth?.role!=='admin') return res.status(403).json({error:'Administrator access is required for this action.'})

  next()

}

app.get('/api/auth/me',(req:AuthRequest,res)=>{const u=req.auth!;res.json({name:u.name,email:u.email,role:u.role})})

app.get('/api/users',requireAdmin,async(_req,res)=>{

  try { const users=await User.find({role:'librarian'}).select('_id name email role active created_at').sort({created_at:-1}).lean();res.json(users.map(u=>({id:String(u._id),name:u.name,email:u.email,role:u.role,active:u.active,created_at:u.created_at}))) }

  catch {res.status(500).json({error:'Unable to load staff accounts.'})}

})

app.post('/api/users',requireAdmin,async(req,res)=>{

  const name=typeof req.body?.name==='string'?req.body.name.trim():''

  const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():''

  const password=typeof req.body?.password==='string'?req.body.password:''

  if(!required(name,100)||!/^\S+@\S+\.\S+$/.test(email)||password.length<12||password.length>128) return res.status(400).json({error:'Enter a name, valid email, and password of at least 12 characters.'})

  const salt=randomBytes(16).toString('hex')

  try { const user=await User.create({name,email,role:'librarian',password_salt:salt,password_hash:hashPassword(password,salt),active:true});res.status(201).json({id:String(user._id),name:user.name,email:user.email,role:user.role,active:user.active,created_at:user.created_at}) }

  catch(e:any){res.status(e?.code===11000?409:400).json({error:e?.code===11000?'An account with this email already exists.':'Unable to create librarian account.'})}

})

app.patch('/api/users/:id/status',requireAdmin,async(req,res)=>{

  if(!Types.ObjectId.isValid(req.params.id)) return res.status(400).json({error:'Invalid account ID.'})

  if(typeof req.body?.active!=='boolean') return res.status(400).json({error:'Active status must be true or false.'})

  if(req.params.id===(req as AuthRequest).auth?.userId&&!req.body.active) return res.status(400).json({error:'You cannot deactivate your own account.'})

  try {const user=await User.findOneAndUpdate({_id:req.params.id,role:'librarian'},{$set:{active:req.body.active}},{new:true}).select('_id name email role active created_at').lean();if(!user)return res.status(404).json({error:'Librarian account not found.'});res.json({id:String(user._id),name:user.name,email:user.email,role:user.role,active:user.active,created_at:user.created_at})}

  catch {res.status(500).json({error:'Unable to update account status.'})}

})



const smtpHost=process.env.SMTP_HOST?.trim(), smtpPort=Number(process.env.SMTP_PORT||587), smtpUser=process.env.SMTP_USER?.trim(), smtpPass=process.env.SMTP_PASS?.trim(), smtpFrom=process.env.SMTP_FROM?.trim()||smtpUser

const mailer=smtpHost&&smtpUser&&smtpPass ? nodemailer.createTransport({host:smtpHost,port:smtpPort,secure:smtpPort===465,auth:{user:smtpUser,pass:smtpPass}}) : null

async function sendEmail(to:string,subject:string,message:string){ if(!mailer||!smtpFrom) throw Error('SMTP email is not configured.'); await mailer.sendMail({from:smtpFrom,to,subject,text:message}) }



app.post('/api/settings/test-email', requireAdmin, async (req,res) => {

  const to=typeof req.body?.to==='string'?req.body.to.trim():''

  if(!/^\S+@\S+\.\S+$/.test(to)) return res.status(400).json({error:'Enter a valid recipient email address.'})

  if(!mailer||!smtpFrom) return res.status(400).json({error:'SMTP is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM to the Render backend environment.'})

  try {

    await mailer.verify()

    await sendEmail(to,'Shelfwise SMTP test','Your Shelfwise SMTP configuration is working. Email reminders can be delivered from this account.')

    res.json({ok:true})

  } catch(error) {

    console.error('SMTP test failed:',error)

    res.status(502).json({error:'SMTP connection or authentication failed. Check the SMTP host, port, username, password, and sender address in Render.'})

  }

})



async function bookView(book:any) {

  const loan = await Loan.findOne({book_id:book._id,returned_at:null}).lean()

  const student = loan ? await Student.findById(loan.student_id).lean() : null

  const today=dateOnly(), status: 'available'|'borrowed'|'overdue' = !loan ? 'available' : loan.due_date < today ? 'overdue' : 'borrowed'

  const overdueDays=loan ? daysBetween(loan.due_date,today) : 0

  return {id:idOf(book),title:book.title,author:book.author,isbn:book.isbn,category:book.category,created_at:book.created_at,status,due_date:loan?.due_date||null,loan_id:loan?idOf(loan):null,borrower:student?.name||null,days_borrowed:loan?daysBetween(dateOnly(new Date(loan.borrowed_at)),today):null,overdue_days:loan?overdueDays:null,penalty:loan?Math.max(overdueDays-PENALTY_GRACE_DAYS,0)*PENALTY_PER_DAY:null}

}

async function studentView(student:any) {

  const activeLoan=await Loan.findOne({student_id:student._id,returned_at:null}).lean()

  const latestReturnedLoan=activeLoan?null:await Loan.findOne({student_id:student._id,returned_at:{$ne:null}}).sort({returned_at:-1}).lean()

  const loan=activeLoan||latestReturnedLoan

  const book=loan?await Book.findById(loan.book_id).lean():null

  const today=dateOnly(), status: 'available'|'borrowed'|'overdue'|'returned'|null=activeLoan?(activeLoan.due_date<today?'overdue':'borrowed'):latestReturnedLoan?'returned':null

  const overdue=activeLoan?daysBetween(activeLoan.due_date,today):0

  const borrowedDays = loan?.borrowed_at
    ? daysBetween(
        dateOnly(new Date(loan.borrowed_at)),
        latestReturnedLoan?.returned_at
          ? dateOnly(new Date(latestReturnedLoan.returned_at))
          : today
      )
    : null

  return {id:idOf(student),name:student.name,student_number:student.student_number,course:student.course,year_level:student.year_level,email:student.email,created_at:student.created_at,borrowed_book:book?.title||null,borrowed_book_id:book?idOf(book):null,loan_id:activeLoan?idOf(activeLoan):null,loan_status:status,borrowed_at:loan?.borrowed_at||null,due_date:loan?.due_date||null,returned_at:latestReturnedLoan?.returned_at||null,days_borrowed:borrowedDays,overdue_days:activeLoan?overdue:0,penalty:activeLoan?Math.max(overdue-PENALTY_GRACE_DAYS,0)*PENALTY_PER_DAY:0}

}



app.get('/api/books', async (req,res) => {

  try {

    const q=String(req.query.search??'').trim(), status=String(req.query.status??'all')

    const docs=await Book.find(q?{$or:[{title:{$regex:escapeRegex(q),$options:'i'}},{author:{$regex:escapeRegex(q),$options:'i'}},{isbn:{$regex:escapeRegex(q),$options:'i'}}]}:{}).sort({created_at:-1,_id:-1}).lean()

    const rows=await Promise.all(docs.map(bookView)); const monitored=rows.filter(b=>b.status!=='available'); res.json(status==='all'?monitored:monitored.filter(b=>b.status===status))

  } catch(e){res.status(500).json({error:'Unable to load books.'})}

})

app.get('/api/stats', async (_req,res) => {

  try { const today=dateOnly(); const [totalBorrowed,returned,active]=await Promise.all([Loan.countDocuments({}),Loan.countDocuments({returned_at:{$ne:null}}),Loan.find({returned_at:null}).select('due_date').lean()]); const currentlyOnLoan=active.filter(l=>l.due_date>=today).length; const overdue=active.filter(l=>l.due_date<today).length; res.json({totalBorrowed,currentlyOnLoan,overdue,returned}) }

  catch {res.status(500).json({error:'Unable to load statistics.'})}

})

app.get('/api/notifications', async (_req,res) => {

  try { const today=dateOnly(), end=dateOnly(new Date(Date.now()+3*86400000)); const loans=await Loan.find({returned_at:null,due_date:{$gte:today,$lte:end}}).sort({due_date:1}).lean(); const items=await Promise.all(loans.map(async l=>{const [book,student]=await Promise.all([Book.findById(l.book_id).lean(),Student.findById(l.student_id).lean()]);return {id:idOf(l),title:book?.title||'Unknown book',student:student?.name||'Unknown student',due_date:l.due_date,days_left:daysBetween(today,l.due_date)}})); res.json(items) }

  catch {res.status(500).json({error:'Unable to load notifications.'})}

})

app.post('/api/notifications/send-email', async (req,res) => {

  const {student_id}=req.body||{}

  if(!student_id||!asId(student_id)) return res.status(400).json({error:'A valid student ID is required.'})

  if(!mailer||!smtpFrom) return res.status(400).json({error:'SMTP email is not configured. Add your SMTP settings to the backend environment.'})

  try {

    const student=await Student.findById(student_id).lean()

    if(!student) return res.status(404).json({error:'Student not found.'})

    if(!student.email||!/^\S+@\S+\.\S+$/.test(student.email)) return res.status(400).json({error:'This student does not have a valid email address.'})

    const loan=await Loan.findOne({student_id:student._id,returned_at:null}).lean()

    const book=loan?await Book.findById(loan.book_id).lean():null

    const subject=loan&&book?'Shelfwise book return reminder':'Message from Shelfwise Library'

    const message=loan&&book

      ? `Hello ${student.name},\n\nThis is a manual reminder from Shelfwise Library about your borrowed book.\n\nBook: ${book.title}\nDue date: ${loan.due_date}\n\nPlease return the book to the library on or before the due date. If you have already returned it, please disregard this message.\n\nShelfwise Library`

      : `Hello ${student.name},\n\nThis is a message from Shelfwise Library. Please contact the library if you need assistance with your student record.\n\nShelfwise Library`

    await sendEmail(student.email,subject,message)

    res.json({ok:true,email:student.email})

  } catch(error) {

    console.error('Manual student email failed:',error)

    res.status(502).json({error:'Unable to send email. Check the SMTP configuration and try again.'})

  }

})

app.get('/api/students', async (req,res) => {

  try {const q=String(req.query.search??'').trim(); const filter=q?{$or:[{name:{$regex:escapeRegex(q),$options:'i'}},{student_number:{$regex:escapeRegex(q),$options:'i'}},{course:{$regex:escapeRegex(q),$options:'i'}}]}:{}; const docs=await Student.find(filter).sort({name:1}).lean(); res.json(await Promise.all(docs.map(studentView)))} catch {res.status(500).json({error:'Unable to load students.'})}

})

app.get('/api/students/:id/borrowing-history', async (req,res) => {
  if(!asId(req.params.id)) return res.status(400).json({error:'Invalid student ID.'})
  try {
    const student=await Student.findById(req.params.id).lean()
    if(!student) return res.status(404).json({error:'Student not found.'})
    const loans=await Loan.find({student_id:student._id}).sort({borrowed_at:-1}).lean()
    const today=dateOnly()
    const history=await Promise.all(loans.map(async loan => {
      const book=await Book.findById(loan.book_id).lean()
      const returnedAt=loan.returned_at||null
      const isOverdue=!returnedAt && loan.due_date<today
      const overdueDays=isOverdue?daysBetween(loan.due_date,today):0
      return {id:idOf(loan),book_title:book?.title||'Book record unavailable',borrowed_at:loan.borrowed_at,due_date:loan.due_date,returned_at:returnedAt,status:returnedAt?'Returned':isOverdue?'Overdue':'Borrowed',overdue_days:overdueDays,penalty:Math.max(overdueDays-PENALTY_GRACE_DAYS,0)*PENALTY_PER_DAY}
    }))
    res.json(history)
  } catch(error) {
    console.error('Borrowing history lookup failed:',error)
    res.status(500).json({error:'Unable to load borrowing history.'})
  }
})

app.post('/api/students', async (req,res) => {

  const {name,student_number,course,year_level,email}=req.body||{}
  const libraryId = typeof student_number === 'string' ? student_number.trim().toUpperCase() : ''
  if(![name,libraryId,course,year_level,email].every(v=>required(v))||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email||''))) return res.status(400).json({error:'Name, student library ID number, course, year, and email are required.'})
  try {
    const duplicate = await Student.findOne({student_number:{$regex:`^${escapeRegex(libraryId)}$`,$options:'i'}}).lean()
    if (duplicate) return res.status(409).json({error:'That student library ID number is already registered. Use a unique ID number.'})
    const doc=await Student.create({name,student_number:libraryId,course,year_level,email})
    res.status(201).json(await studentView(doc.toObject()))
  } catch(e:any) {
    res.status(e?.code===11000?409:400).json({error:e?.code===11000?'That student library ID number is already registered. Use a unique ID number.':'Unable to create student.'})
  }

})

app.patch('/api/students/:id', async (req,res) => {

  const {name,course,year_level,email}=req.body||{}

  if(!asId(req.params.id)) return res.status(400).json({error:'Invalid student ID.'})

  if(![name,course,year_level,email].every(v=>required(v))||!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({error:'Name, course, year, and email are required.'})

  try {const doc=await Student.findByIdAndUpdate(req.params.id,{name,course,year_level,email},{new:true,runValidators:true}).lean(); if(!doc)return res.status(404).json({error:'Student not found.'});res.json(await studentView(doc))} catch(e:any){res.status(e?.code===11000?409:400).json({error:'Unable to update student.'})}

})

app.post('/api/loans', async (req,res) => {

  const {book_id,book_title,student_id,student_name,course,year_level,email,due_date}=req.body||{}

  if((!book_id&&!required(book_title))||(!student_id&&!required(student_name))||!required(email)||!/^\S+@\S+\.\S+$/.test(email)||!validDate(due_date)||due_date<dateOnly()) return res.status(400).json({error:'Book title, student name, valid email, and a valid due date are required.'})

  const session=await mongoose.startSession()

  try {

    await session.withTransaction(async()=>{

      let book:any=book_id&&asId(book_id)?await Book.findById(book_id).session(session):null

      if(!book&&book_title){book=await Book.create([{title:String(book_title).trim(),author:'Manual check by admin',isbn:`MANUAL-${randomBytes(10).toString('hex')}`,category:'Manual entry'}],{session});book=book[0]}

      if(!book) throw Error('Book not found.')

      let student:any=student_id&&asId(student_id)?await Student.findById(student_id).session(session):null

      if(!student&&student_name){student=await Student.findOne({name:{$regex:`^${escapeRegex(String(student_name).trim())}$`,$options:'i'}}).session(session); if(student){student.course=course||student.course;student.year_level=year_level||student.year_level;student.email=email||student.email;await student.save({session})} else {const created=await Student.create([{name:String(student_name).trim(),student_number:`MANUAL-${randomBytes(10).toString('hex')}`,course:String(course||'Undeclared'),year_level:String(year_level||'1st year'),email}],{session});student=created[0]}}

      if(!student) throw Error('Student not found.')

      if(await Loan.exists({book_id:book._id,returned_at:null}).session(session)) throw Error('That book is already on loan.')

      if(await Loan.exists({student_id:student._id,returned_at:null}).session(session)) throw Error('That student already has an active loan.')

      await Loan.create([{book_id:book._id,student_id:student._id,due_date}],{session})

    })

    res.status(201).json({ok:true})

  } catch(e:any){res.status(409).json({error:e?.code===11000?'The book or student already has an active loan.':e instanceof Error?e.message:'Loan could not be saved.'})}

  finally{await session.endSession()}

})

app.patch('/api/loans/:id/return', async (req,res) => {

  if(!asId(req.params.id))return res.status(400).json({error:'Invalid loan ID.'})

  try {const loan=await Loan.findOne({_id:req.params.id,returned_at:null});if(!loan)return res.status(404).json({error:'Active loan not found.'});loan.returned_at=new Date();await loan.save();res.json({ok:true})}catch{res.status(500).json({error:'Unable to return this book.'})}

})

app.post('/api/books', async (req,res) => {

  const {title,author,isbn,category}=req.body||{}

  if(![title,author,isbn,category].every(v=>required(v)))return res.status(400).json({error:'Title, author, ISBN, and category are required.'})

  try{const book=await Book.create({title,author,isbn,category});res.status(201).json(await bookView(book.toObject()))}catch(e:any){res.status(e?.code===11000?409:400).json({error:e?.code===11000?'A book with that ISBN already exists.':'Unable to create book.'})}

})

app.patch('/api/books/:id/status', async(req,res)=>{

  if(!asId(req.params.id))return res.status(400).json({error:'Invalid book ID.'})

  if(req.body?.status!=='available')return res.status(400).json({error:'Use the loan workflow to borrow books.'})

  const book=await Book.findById(req.params.id).lean();if(!book)return res.status(404).json({error:'Book not found.'})

  if(await Loan.exists({book_id:book._id,returned_at:null}))return res.status(409).json({error:'Return the active loan through the return workflow first.'})

  res.json(await bookView(book))

})

app.delete('/api/books/:id', async(req,res)=>{

  if(!asId(req.params.id))return res.status(400).json({error:'Invalid book ID.'})

  const book=await Book.findById(req.params.id);if(!book)return res.status(404).json({error:'Book not found.'})

  if(await Loan.exists({book_id:book._id}))return res.status(409).json({error:'Cannot delete a book with loan history.'})

  await book.deleteOne();res.status(204).end()

})

app.delete('/api/books', (_req,res)=>res.status(403).json({error:'Bulk deletion is disabled to protect library records.'}))



async function sendDueDateReminders(){

  const today=dateOnly()

  const activeLoans=await Loan.find({returned_at:null}).lean()

  for(const loan of activeLoans){

    try {

      const [book,student]=await Promise.all([Book.findById(loan.book_id).lean(),Student.findById(loan.student_id).lean()])

      if(!book||!student) continue

      const daysUntilDue=Math.round((Date.parse(`${loan.due_date}T00:00:00Z`)-Date.parse(`${today}T00:00:00Z`))/86400000)

      const isScheduledDay=[7,3,1,0].includes(daysUntilDue)

      if(!isScheduledDay&&daysUntilDue>0) continue

      const reminderKey=daysUntilDue<0?`overdue-${today}`:`due-${daysUntilDue}-${loan.due_date}`

      const subject=daysUntilDue<0?'Shelfwise overdue book reminder':'Shelfwise book return reminder'

      const message=daysUntilDue>0

        ? `Hello ${student.name},\n\nThis is a reminder that your borrowed book is due in ${daysUntilDue} day${daysUntilDue===1?'':'s'}.\n\nBook: ${book.title}\nDue date: ${loan.due_date}\n\nPlease return it to the library on or before the due date.\n\nShelfwise Library`

        : daysUntilDue===0

          ? `Hello ${student.name},\n\nYour borrowed book is due today. Please return it to the library today to avoid an overdue record.\n\nBook: ${book.title}\nDue date: ${loan.due_date}\n\nShelfwise Library`

          : `Hello ${student.name},\n\nOur records show that your borrowed book is overdue by ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue)===1?'':'s'}. Please return it to the library as soon as possible.\n\nBook: ${book.title}\nDue date: ${loan.due_date}\n\nIf you have already returned it, please contact the library so the record can be updated.\n\nShelfwise Library`



      if(mailer&&smtpFrom&&student.email&&loan.last_email_reminder_key!==reminderKey){

        try {

          await sendEmail(student.email,subject,message)

          await Loan.updateOne({_id:loan._id},{$set:{last_email_reminder_key:reminderKey}})

        } catch(error) { console.error(`Email reminder failed for loan ${loan._id}:`,error) }

      }



    } catch(error) {

      console.error(`Due-date reminder processing failed for loan ${loan._id}:`,error)

    }

  }

}



let reminderTimer:NodeJS.Timeout|undefined

const port=Number(process.env.PORT||3002)

async function start(){await mongoose.connect(mongoUri!,{serverSelectionTimeoutMS:15000});console.log('Connected to MongoDB Atlas');await Promise.all([Book.init(),Student.init(),Loan.init(),User.init()]);const existingAdmin=await User.findOne({email:adminEmail!});if(!existingAdmin){const salt=randomBytes(16).toString('hex');await User.create({name:adminName,email:adminEmail,role:'admin',password_salt:salt,password_hash:hashPassword(adminPassword!,salt),active:true});console.log(`Initial administrator account created: ${adminEmail}`)}app.listen(port,'0.0.0.0',()=>console.log(`Shelfwise API listening on ${port}`));void sendDueDateReminders();reminderTimer=setInterval(()=>void sendDueDateReminders(),60*60*1000)}

start().catch(error=>{console.error('Backend startup failed:',error);process.exit(1)})

process.on('SIGTERM',async()=>{if(reminderTimer)clearInterval(reminderTimer);await mongoose.disconnect();process.exit(0)})
