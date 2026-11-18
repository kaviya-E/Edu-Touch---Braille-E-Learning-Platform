from flask import Flask, render_template, request, redirect, url_for, flash, jsonify, send_file, send_from_directory
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from models import db, User, Lesson, Quiz, Question, QuizResult, Feedback
from braille_converter import text_to_braille, create_braille_pdf
from werkzeug.utils import secure_filename
from PyPDF2 import PdfReader
from braille_converter import text_to_braille, save_as_brf
from docx import Document
from pptx import Presentation
from quiz_generator import generate_quiz_from_text
import os
import tempfile
import json
from gtts import gTTS
import io
# ================= TEXT EXTRACT =================
def extract_text_from_file(filepath):
    text = ""
    if filepath.endswith(".pdf"):
        reader = PdfReader(filepath)
        for page in reader.pages:
            text += page.extract_text() or ""
    elif filepath.endswith(".docx"):
        doc = Document(filepath)
        for para in doc.paragraphs:
            text += para.text + "\n"
    elif filepath.endswith(".pptx"):
        prs = Presentation(filepath)
        for slide in prs.slides:
            for shape in slide.shapes:
                if hasattr(shape, "text"):
                    text += shape.text + "\n"
    elif filepath.endswith(".txt"):
        with open(filepath, "r", encoding="utf-8") as f:
            text = f.read()
    return text
app = Flask(__name__)
# ================= CONFIG =================
app.config['SECRET_KEY'] = 'your-secret-key-change-this-in-production'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///database.db'
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'uploads')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])
# ================= EXTENSIONS =================
db.init_app(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'
@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))
# ================= DATABASE =================
with app.app_context():
    db.create_all()
# ================= HOME =================
@app.route('/')
def index():
    if current_user.is_authenticated:
        if current_user.role == 'admin':
            return redirect(url_for('admin_dashboard'))
        elif current_user.role == 'instructor':
            return redirect(url_for('instructor_dashboard'))
        else:
            return redirect(url_for('student_dashboard'))
    return redirect(url_for('login'))
# ================= REGISTER =================
@app.route('/register', methods=['GET','POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        email = request.form.get('email', '').strip()
        password = request.form.get('password')
        role = request.form.get('role')
        contact_number = request.form.get('contact_number')
        if not username or not email or not password or not role:
            flash('All fields are required!', 'danger')
            return redirect(url_for('register'))
        if role not in ['instructor', 'student', 'admin']:
            flash('Invalid role selected!', 'danger')
            return redirect(url_for('register'))
        if User.query.filter_by(username=username).first():
            flash('Username already exists!', 'danger')
            return redirect(url_for('register'))
        if User.query.filter_by(email=email).first():
            flash('Email already registered!', 'danger')
            return redirect(url_for('register'))
        new_user = User(username=username, email=email, role=role, contact_number=contact_number)
        new_user.set_password(password)
        db.session.add(new_user)
        db.session.commit()
        flash('Registration successful!', 'success')
        return redirect(url_for('login'))
    return render_template('register.html')
# ================= LOGIN =================
@app.route('/login', methods=['GET','POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password')
        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password):
            login_user(user)
            return redirect(url_for('index'))
        flash('Invalid login', 'danger')
    return render_template('login.html')
# ================= LOGOUT =================
@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))
# ================= DASHBOARD =================
@app.route('/admin/dashboard')
@login_required
def admin_dashboard():
    if current_user.role != 'admin':
        flash('Access denied.', 'danger')
        return redirect(url_for('index'))
    admins = User.query.filter_by(role='admin').all()
    instructors = User.query.filter_by(role='instructor').all()
    students = User.query.filter_by(role='student').all()
    lessons = Lesson.query.all()
    quizzes = Quiz.query.all()
    feedbacks = Feedback.query.order_by(Feedback.created_at.desc()).all()
    return render_template('admin_dashboard.html', 
                           admins=admins,
                           instructors=instructors, 
                           students=students, 
                           lessons=lessons,
                           quizzes=quizzes,
                           feedbacks=feedbacks)
@app.route('/admin/user/delete/<int:user_id>', methods=['POST'])
@login_required
def delete_user(user_id):
    if current_user.role != 'admin':
        flash('Access denied.', 'danger')
        return redirect(url_for('index'))
    user = User.query.get_or_404(user_id)
    # Prevent self-deletion
    if user.id == current_user.id:
        flash('You cannot delete your own account!', 'danger')
        return redirect(url_for('admin_dashboard'))
    db.session.delete(user)
    db.session.commit()
    flash(f'User {user.username} has been deleted.', 'success')
    return redirect(url_for('admin_dashboard'))
@app.route('/admin/feedback/delete/<int:feedback_id>', methods=['POST'])
@login_required
def delete_feedback(feedback_id):
    if current_user.role != 'admin':
        flash('Access denied.', 'danger')
        return redirect(url_for('index'))
    feedback = Feedback.query.get_or_404(feedback_id)
    db.session.delete(feedback)
    db.session.commit()
    flash('Feedback has been removed.', 'success')
    return redirect(request.referrer or url_for('admin_dashboard'))
@app.route('/admin/instructor/<int:instructor_id>/activity')
@login_required
def admin_instructor_activity(instructor_id):
    if current_user.role != 'admin':
        flash('Access denied.', 'danger')
        return redirect(url_for('index'))
    instructor = User.query.get_or_404(instructor_id)
    if instructor.role != 'instructor':
        flash('User is not an instructor.', 'warning')
        return redirect(url_for('admin_dashboard'))
    lessons = Lesson.query.filter_by(instructor_id=instructor_id).order_by(Lesson.created_at.desc()).all()
    feedbacks = Feedback.query.filter_by(instructor_id=instructor_id).order_by(Feedback.created_at.desc()).all()
    return render_template('admin_instructor_activity.html', instructor=instructor, lessons=lessons, feedbacks=feedbacks)

@app.route('/admin/student/<int:student_id>/activity')
@login_required
def admin_student_activity(student_id):
    if current_user.role != 'admin':
        flash('Access denied.', 'danger')
        return redirect(url_for('index'))
    student = User.query.get_or_404(student_id)
    if student.role != 'student':
        flash('User is not a student.', 'warning')
        return redirect(url_for('admin_dashboard'))
    results = QuizResult.query.filter_by(student_id=student_id).order_by(QuizResult.submitted_at.desc()).all()
    feedbacks = Feedback.query.filter_by(student_id=student_id).order_by(Feedback.created_at.desc()).all()
    return render_template('admin_student_activity.html', student=student, results=results, feedbacks=feedbacks)

@app.route('/instructor/dashboard')
@login_required
def instructor_dashboard():
    if current_user.role != 'instructor':
        flash('Access denied.', 'danger')
        return redirect(url_for('index'))
    lessons = Lesson.query.filter_by(instructor_id=current_user.id).all()
    feedbacks = Feedback.query.filter_by(instructor_id=current_user.id).order_by(Feedback.created_at.desc()).all()
    return render_template('instructor_dashboard.html', lessons=lessons, feedbacks=feedbacks)
# ================= CREATE =================
@app.route('/instructor/lesson/create', methods=['GET','POST'])
@login_required
def create_lesson():
    if request.method == 'POST':
        title = request.form.get('title')
        content = request.form.get('content')
        language = request.form.get('language') # NEW
        file = request.files.get('lesson_file')
        file_path = None
        extracted_text = ""
        if file and file.filename != "":
            # `secure_filename` destroys Tamil unicode characters. We securely sanitize traversing paths instead.
            filename = file.filename.replace("/", "").replace("\\", "").replace("..", "")
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
            file_path = filename
            extracted_text = extract_text_from_file(filepath)
            if not content:
                content = extracted_text
        # ALWAYS use only textarea content for main braille
        braille_content = text_to_braille(content, language) if content else ""
        lesson = Lesson(
            title=title,
            content=content,
            braille_content=braille_content,
            file_path=file_path,
            language=language, # NEW
            instructor_id=current_user.id
        )
        db.session.add(lesson)
        db.session.commit()
        return redirect(url_for('instructor_dashboard'))
    return render_template('create_lesson.html')
# ================= EDIT =================
@app.route('/instructor/lesson/edit/<int:lesson_id>', methods=['GET','POST'])
@login_required
def edit_lesson(lesson_id):
    lesson = Lesson.query.get_or_404(lesson_id)

    if request.method == 'POST':
        lesson.title = request.form.get('title')
        lesson.content = request.form.get('content')
        lesson.language = request.form.get('language') # NEW
        # Add file upload handling for editing
        file = request.files.get('lesson_file')
        if file and file.filename != "":
            # Pass original Tamil name, bypassing secure_filename destructive deletion
            filename = file.filename.replace("/", "").replace("\\", "").replace("..", "")
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
            lesson.file_path = filename
            # If no content was provided, extract it
            if not lesson.content:
                lesson.content = extract_text_from_file(filepath)
        lesson.braille_content = text_to_braille(lesson.content, lesson.language)
        db.session.commit()
        return redirect(url_for('instructor_dashboard'))
    return render_template('edit_lesson.html', lesson=lesson)
# ================= DELETE =================
@app.route('/instructor/lesson/delete/<int:lesson_id>', methods=['POST'])
@login_required
def delete_lesson(lesson_id):
    lesson = Lesson.query.get_or_404(lesson_id)
    db.session.delete(lesson)
    db.session.commit()
    return redirect(url_for('instructor_dashboard'))
# ================= STUDENT =================
@app.route('/student/dashboard')
@login_required
def student_dashboard():
    lessons = Lesson.query.all()
    return render_template('student_dashboard.html', lessons=lessons)
# ================= VIEW =================
@app.route('/student/lesson/<int:lesson_id>')
@login_required
def view_lesson(lesson_id):
    lesson = Lesson.query.get_or_404(lesson_id)
    file_content = ""
    if lesson.file_path:
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], lesson.file_path)
        if os.path.exists(filepath):
            file_content = extract_text_from_file(filepath)
    existing_feedback = None
    if current_user.is_authenticated and current_user.role == 'student':
        existing_feedback = Feedback.query.filter_by(student_id=current_user.id, lesson_id=lesson.id).first() 
    return render_template("view_lesson.html", lesson=lesson, file_content=file_content, existing_feedback=existing_feedback)
@app.route('/student/lesson/<int:lesson_id>/audio/download')
@login_required
def download_audio(lesson_id):
    lesson = Lesson.query.get_or_404(lesson_id)
    # Combined text for complete audio
    text = lesson.content or ""
    if lesson.file_path:
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], lesson.file_path)
        if os.path.exists(filepath):
            text += "\n" + extract_text_from_file(filepath)
    if not text.strip():
        flash("No text content available to generate audio.", "warning")
        return redirect(url_for('view_lesson', lesson_id=lesson.id))
    # Generate MP3 using gTTS
    lang = 'ta' if lesson.language == 'tamil' else 'en'
    try:
        tts = gTTS(text=text, lang=lang)
        fp = io.BytesIO()
        tts.write_to_fp(fp)
        fp.seek(0)
        # Proper filename
        safe_title = "".join([c for c in lesson.title if c.isalnum() or c==' ']).rstrip()
        filename = f"{safe_title}_audio.mp3"
        return send_file(fp, mimetype='audio/mpeg', as_attachment=True, download_name=filename)
    except Exception as e:
        flash(f"Audio generation failed: {str(e)}", "danger")
        return redirect(url_for('view_lesson', lesson_id=lesson.id))
# ================= FILE =================
@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename,as_attachment=False)
# ================= BRAILLE =================
@app.route('/download_braille/<int:lesson_id>')
@login_required
def download_braille_pdf(lesson_id):
    lesson = Lesson.query.get_or_404(lesson_id)
    pdf_file = create_braille_pdf(lesson.braille_content)
    return send_file(pdf_file, as_attachment=True)
# ================= FILE BRAILLE VIEW =================
@app.route('/view_file_braille/<int:lesson_id>')
@login_required
def view_file_braille(lesson_id):
    lesson = Lesson.query.get_or_404(lesson_id)
    if not lesson.file_path:
        flash("No file uploaded!", "danger")
        return redirect(url_for('view_lesson', lesson_id=lesson.id))
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], lesson.file_path)
    # 🔥 STEP 1: extract text
    extracted_text = extract_text_from_file(filepath)
    # 🔥 STEP 2: convert to braille (THIS WAS MISSING)
    braille_text = text_to_braille(extracted_text, lesson.language)
    # 🔥 STEP 3: send to HTML
    return render_template(
        "file_braille_view.html",
        braille=braille_text,
        original_text=extracted_text,
        lesson=lesson
    )
# ================= FILE BRAILLE DOWNLOAD =================
@app.route('/download_file_braille/<int:lesson_id>')
@login_required
def download_file_braille(lesson_id):
    lesson = Lesson.query.get_or_404(lesson_id)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], lesson.file_path)
    text = extract_text_from_file(filepath)
    braille = text_to_braille(text, lesson.language)
    pdf = create_braille_pdf(braille)
    return send_file(pdf, as_attachment=True)
@app.route('/view_braille/<int:lesson_id>')
@login_required
def view_braille_pdf(lesson_id):
    lesson = Lesson.query.get_or_404(lesson_id)
    return render_template(
        "lesson_braille_view.html",
        lesson=lesson
    )
@app.route("/download_brf/<int:lesson_id>")
def download_brf(lesson_id):
    lesson = Lesson.query.get_or_404(lesson_id)
    braille_text = text_to_braille(lesson.content, lesson.language)
    file_path = save_as_brf(braille_text)
    return send_file(file_path, as_attachment=True)
# ================= QUIZ GENERATE =================
@app.route('/instructor/lesson/<int:lesson_id>/generate-quiz', methods=['POST'])
@login_required
def generate_quiz(lesson_id):
    if current_user.role != 'instructor':
        flash('Access denied.', 'danger')
        return redirect(url_for('index'))
    lesson = Lesson.query.get_or_404(lesson_id)
    # Gather text: lesson content + uploaded file content
    combined_text = lesson.content or ''
    if lesson.file_path:
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], lesson.file_path)
        if os.path.exists(filepath):
            combined_text += '\n' + extract_text_from_file(filepath)

    if len(combined_text.strip()) < 50:
        flash('Not enough text content to generate a quiz. Please add more content.', 'warning')
        return redirect(url_for('instructor_dashboard'))
    # Delete existing quiz for this lesson if any
    if lesson.quiz:
        db.session.delete(lesson.quiz)
        db.session.commit()
    # Generate questions
    questions_data = generate_quiz_from_text(combined_text, num_questions=8)
    if not questions_data:
        flash('Could not generate quiz questions from the content. Try adding more descriptive text.', 'warning')
        return redirect(url_for('instructor_dashboard'))
    # Save Quiz
    quiz = Quiz(title=f'Quiz: {lesson.title}', lesson_id=lesson.id)
    db.session.add(quiz)
    db.session.flush()  # get quiz.id
    for qdata in questions_data:
        q = Question(
            quiz_id=quiz.id,
            question_text=qdata['question_text'],
            option_a=qdata['option_a'],
            option_b=qdata['option_b'],
            option_c=qdata['option_c'],
            option_d=qdata['option_d'],
            correct_answer=qdata['correct_answer'],
            question_type=qdata['question_type'],
        )
        db.session.add(q)
    db.session.commit()
    flash(f'Quiz generated with {len(questions_data)} questions!', 'success')
    return redirect(url_for('quiz_preview', quiz_id=quiz.id))
# ================= QUIZ PREVIEW (INSTRUCTOR) =================
@app.route('/instructor/quiz/<int:quiz_id>')
@login_required
def quiz_preview(quiz_id):
    if current_user.role != 'instructor':
        flash('Access denied.', 'danger')
        return redirect(url_for('index'))
    quiz = Quiz.query.get_or_404(quiz_id)
    results = QuizResult.query.filter_by(quiz_id=quiz_id).all()
    return render_template('quiz_preview.html', quiz=quiz, results=results)
# ================= QUIZ DELETE =================
@app.route('/instructor/quiz/<int:quiz_id>/delete', methods=['POST'])
@login_required
def delete_quiz(quiz_id):
    if current_user.role != 'instructor':
        flash('Access denied.', 'danger')
        return redirect(url_for('index'))
    quiz = Quiz.query.get_or_404(quiz_id)
    db.session.delete(quiz)
    db.session.commit()
    flash('Quiz deleted.', 'success')
    return redirect(url_for('instructor_dashboard'))
# ================= QUIZ TAKE (STUDENT) =================
@app.route('/student/quiz/<int:quiz_id>')
@login_required
def take_quiz(quiz_id):
    if current_user.role != 'student':
        flash('Access denied.', 'danger')
        return redirect(url_for('index'))
    quiz = Quiz.query.get_or_404(quiz_id)
    # Check if already attempted
    existing = QuizResult.query.filter_by(quiz_id=quiz_id, student_id=current_user.id).first()
    return render_template('quiz_take.html', quiz=quiz, existing=existing)
# ================= QUIZ SUBMIT =================
@app.route('/student/quiz/<int:quiz_id>/submit', methods=['POST'])
@login_required
def submit_quiz(quiz_id):
    if current_user.role != 'student':
        flash('Access denied.', 'danger')
        return redirect(url_for('index'))
    quiz = Quiz.query.get_or_404(quiz_id)
    questions = quiz.questions
    score = 0
    answers = {}
    for q in questions:
        chosen = request.form.get(f'q_{q.id}', '')
        answers[str(q.id)] = chosen
        if chosen.upper() == q.correct_answer.upper():
            score += 1
    # Delete previous attempt if any
    QuizResult.query.filter_by(quiz_id=quiz_id, student_id=current_user.id).delete()
    result = QuizResult(
        quiz_id=quiz_id,
        student_id=current_user.id,
        score=score,
        total=len(questions),
        answers_json=json.dumps(answers)
    )
    db.session.add(result)
    db.session.commit()
    flash(f'Quiz submitted! You scored {score} out of {len(questions)}.', 'success')
    return redirect(url_for('quiz_result', result_id=result.id))
# ================= QUIZ RESULT (STUDENT) =================
@app.route('/student/result/<int:result_id>')
@login_required
def quiz_result(result_id):
    result = QuizResult.query.get_or_404(result_id)
    if result.student_id != current_user.id and current_user.role not in ['admin', 'instructor']:
        flash('Access denied.', 'danger')
        return redirect(url_for('index'))
    answers = json.loads(result.answers_json)
    return render_template('quiz_result.html', result=result, answers=answers)
# ================= FEEDBACK SUBMIT =================
@app.route('/student/feedback/submit', methods=['POST'])
@login_required
def submit_feedback():
    if current_user.role != 'student':
        return jsonify({'error': 'Students only'}), 403
    instructor_id = request.form.get('instructor_id')
    lesson_id = request.form.get('lesson_id')
    rating = request.form.get('rating')
    comment = request.form.get('comment')
    if not instructor_id or not rating:
        flash('Rating is required!', 'warning')
        return redirect(request.referrer or url_for('student_dashboard'))
    existing_feedback = Feedback.query.filter_by(student_id=current_user.id, lesson_id=lesson_id).first()
    if existing_feedback:
        existing_feedback.rating = int(rating)
        existing_feedback.comment = comment
        db.session.commit()
        flash('Feedback updated successfully!', 'success')
    else:
        new_feedback = Feedback(
            student_id=current_user.id,
            instructor_id=instructor_id,
            lesson_id=lesson_id if lesson_id else None,
            rating=int(rating),
            comment=comment
        )
        db.session.add(new_feedback)
        db.session.commit()
        flash('Thank you for your feedback!', 'success')
    return redirect(request.referrer or url_for('student_dashboard'))
# ================= ALL RESULTS (STUDENT) =================
@app.route('/student/my-results')
@login_required
def my_results():
    if current_user.role != 'student':
        flash('Access denied.', 'danger')
        return redirect(url_for('index'))
    results = QuizResult.query.filter_by(student_id=current_user.id).order_by(QuizResult.submitted_at.desc()).all()
    return render_template('my_results.html', results=results)
# ================= INSTRUCTOR RESULTS VIEW =================
@app.route('/instructor/results')
@login_required
def instructor_results():
    if current_user.role != 'instructor':
        flash('Access denied.', 'danger')
        return redirect(url_for('index'))
    # Get all quizzes belonging to this instructor's lessons
    lessons = Lesson.query.filter_by(instructor_id=current_user.id).all()
    lesson_ids = [l.id for l in lessons]
    quizzes = Quiz.query.filter(Quiz.lesson_id.in_(lesson_ids)).all()
    quiz_ids = [q.id for q in quizzes]
    results = QuizResult.query.filter(QuizResult.quiz_id.in_(quiz_ids)).order_by(QuizResult.submitted_at.desc()).all()
    return render_template('instructor_results.html', results=results, quizzes=quizzes)
# ================= RUN =================
if __name__ == '__main__':
    app.run(host="0.0.0.0", port=5001, debug=True)