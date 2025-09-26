/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

// --- DOM Element References ---
const dropZone = document.getElementById('drop-zone') as HTMLLabelElement;
const imageUpload = document.getElementById('image-upload') as HTMLInputElement;
const imagePreviewContainer = document.getElementById('image-preview-container') as HTMLDivElement;
const imagePreviewGrid = document.getElementById('image-preview-grid') as HTMLDivElement;
const processButton = document.getElementById('process-button') as HTMLButtonElement;
const resetButton = document.getElementById('reset-button') as HTMLButtonElement;
const loader = document.getElementById('loader') as HTMLDivElement;
const errorMessage = document.getElementById('error-message') as HTMLDivElement;
const resultContainer = document.getElementById('result-container') as HTMLDivElement;
const resultList = document.getElementById('result-list') as HTMLDivElement;


// --- Constants ---
const MAX_FILES = 10;

// --- State Management ---
interface UploadedFile {
    file: File;
    base64Image: string;
    mimeType: string;
}
let uploadedFiles: UploadedFile[] = [];

// --- Gemini API Initialization ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

// --- Type Definition for KTP Data ---
interface KtpData {
    nik: string;
    nama: string;
    tempatLahir: string;
    tanggalLahir: string;
    jenisKelamin: string;
    alamat: string;
    rt: string;
    rw: string;
    kelDesa: string;
    kecamatan: string;
    kota: string;
    statusPerkawinan: string;
    pekerjaan: string;
    kewarganegaraan: string;
    gelarDepanExpanded?: string;
    gelarBelakangExpanded?: string;
}

// --- Event Listeners ---

// Drag and Drop Events
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drop-zone-active');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drop-zone-active');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drop-zone-active');
    const files = e.dataTransfer?.files;
    if (files) {
        handleNewFileSelection(files);
    }
});

// File Input Change Event
imageUpload.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.files) {
        handleNewFileSelection(target.files);
    }
});

// Paste Image from Clipboard Event
document.addEventListener('paste', (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            const pastedFile = items[i].getAsFile();
            if (pastedFile) {
                const namedFile = new File([pastedFile], `pasted-image-${Date.now()}.${pastedFile.type.split('/')[1]}`, {
                    type: pastedFile.type,
                    lastModified: pastedFile.lastModified,
                });
                imageFiles.push(namedFile);
            }
        }
    }

    if (imageFiles.length > 0) {
        e.preventDefault();
        handleNewFileSelection(createFileList(imageFiles));
    }
});


// Process Button Click Event
processButton.addEventListener('click', async () => {
    if (uploadedFiles.length === 0) {
        showError("Silakan pilih gambar terlebih dahulu.");
        return;
    }

    setLoadingState(true);

    const promises = uploadedFiles.map(fileData => callGeminiApi(fileData));

    try {
        const results = await Promise.all(promises);
        displayResults(results);
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        showError("Gagal mengekstrak informasi. Pastikan gambar KTP jelas dan coba lagi.");
    } finally {
        setLoadingState(false);
    }
});

// Reset Button Click Event
resetButton.addEventListener('click', resetApp);


// Copy Button Click Event (Event Delegation)
resultList.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const copyButton = target.closest('.copy-button');

    if (copyButton) {
        const resultTextElement = copyButton.previousElementSibling as HTMLParagraphElement;
        if (resultTextElement) {
            navigator.clipboard.writeText(resultTextElement.innerText).then(() => {
                copyButton.innerHTML = `
                    <svg class="w-4 h-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                    Tersalin!
                `;
                copyButton.classList.add('bg-green-100', 'text-green-800');

                setTimeout(() => {
                    copyButton.innerHTML = `
                       <svg class="w-4 h-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a2.25 2.25 0 01-2.25 2.25h-1.5a2.25 2.25 0 01-2.25-2.25v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></svg>
                       Salin
                    `;
                    copyButton.classList.remove('bg-green-100', 'text-green-800');
                }, 2000);
            });
        }
    }
});


// --- Core Functions ---

async function callGeminiApi(fileData: UploadedFile): Promise<KtpData> {
     const schema = {
          type: Type.OBJECT,
          properties: {
            nik: { type: Type.STRING, description: "Nomor Induk Kependudukan." },
            nama: { type: Type.STRING, description: "Nama lengkap saja, tanpa gelar depan atau belakang." },
            gelarDepanExpanded: { type: Type.STRING, description: "Kepanjangan dari SEMUA gelar di depan nama. Contoh: 'Prof. Dr.' menjadi 'Profesor Doktor', 'H.' menjadi 'Haji'. Kembalikan string kosong jika tidak ada." },
            gelarBelakangExpanded: { type: Type.STRING, description: "Kepanjangan dari SEMUA gelar di belakang nama. Contoh: 'S.H.' menjadi 'Sarjana Hukum', 'S.Kom., M.T.' menjadi 'Sarjana Komputer, Magister Teknik'. Kembalikan string kosong jika tidak ada." },
            tempatLahir: { type: Type.STRING, description: "Tempat lahir." },
            tanggalLahir: { type: Type.STRING, description: "Tanggal lahir dengan format DD-MM-YYYY." },
            jenisKelamin: { type: Type.STRING, description: "Jenis kelamin, LAKI-LAKI atau PEREMPUAN." },
            alamat: { type: Type.STRING, description: "Alamat jalan dan nomor rumah. Pastikan untuk memperluas singkatan umum (misalnya 'Jl.' menjadi 'Jalan', 'Gg.' menjadi 'Gang')." },
            rt: { type: Type.STRING, description: "Nomor RT." },
            rw: { type: Type.STRING, description: "Nomor RW." },
            kelDesa: { type: Type.STRING, description: "Nama Kelurahan atau Desa." },
            kecamatan: { type: Type.STRING, description: "Nama Kecamatan." },
            kota: { type: Type.STRING, description: "Nama Kota atau Kabupaten tempat tinggal." },
            statusPerkawinan: { type: Type.STRING, description: "Status perkawinan: BELUM KAWIN, KAWIN, CERAI HIDUP, atau CERAI MATI." },
            pekerjaan: { type: Type.STRING, description: "Pekerjaan." },
            kewarganegaraan: { type: Type.STRING, description: "Kewarganegaraan, contoh: WNI." },
          }
        };

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
            parts: [
                { inlineData: { mimeType: fileData.mimeType, data: fileData.base64Image } },
                { text: 'Ekstrak informasi dari gambar KTP ini. Pisahkan nama asli dari gelar. Untuk semua gelar (baik depan maupun belakang), berikan bentuk panjangnya (misalnya "Prof. Dr." menjadi "Profesor Doktor", "S.H." menjadi "Sarjana Hukum"). Perluas juga singkatan umum di alamat (misalnya, "Jl." menjadi "Jalan"). Berikan output sesuai dengan skema JSON yang diberikan.' }
            ]
        },
        config: {
            responseMimeType: 'application/json',
            responseSchema: schema,
        },
    });

    return JSON.parse(response.text) as KtpData;
}

// Handles new file selections from click or drag-drop, which should reset the app state.
function handleNewFileSelection(files: FileList | null) {
    if (!files || files.length === 0) return;
    resetApp();
    addFilesToQueue(files);
}

// Adds files to the current queue, used by all input methods.
function addFilesToQueue(files: FileList) {
    if (uploadedFiles.length + files.length > MAX_FILES) {
        showError(`Total file tidak boleh melebihi ${MAX_FILES}. Saat ini ada ${uploadedFiles.length} file.`);
        imageUpload.value = ''; // Clear file picker in case of error
        return;
    }

    const filesToProcess = Array.from(files);

    filesToProcess.forEach(file => {
        const reader = new FileReader();

        reader.onloadend = () => {
            try {
                const result = reader.result as string;
                if (!result || !result.includes(',')) {
                    throw new Error('Invalid file reader result');
                }
                const parts = result.split(',');
                const mimeType = parts[0].split(':')[1].split(';')[0];
                const base64Image = parts[1];

                if (!mimeType || !base64Image) {
                    throw new Error('Could not parse Data URL');
                }

                uploadedFiles.push({ file, base64Image, mimeType });
                
                const previewElement = document.createElement('div');
                previewElement.className = 'relative group overflow-hidden rounded-lg shadow-md';
                previewElement.innerHTML = `
                    <img src="${result}" class="w-full h-32 object-cover transition-transform duration-300 group-hover:scale-110" alt="Pratinjau ${file.name}">
                    <div class="absolute inset-0 bg-black bg-opacity-40 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent text-white text-xs p-2 truncate">
                        ${file.name}
                    </div>
                `;
                imagePreviewGrid.appendChild(previewElement);
            } catch (error) {
                console.error(`Failed to process file ${file.name}`, error);
                showError(`Gagal memproses pratinjau untuk: ${file.name}`);
            }
        };

        reader.onerror = () => {
            console.error(`Failed to read file ${file.name}`, reader.error);
            showError(`Gagal membaca file: ${file.name}`);
        };
        
        reader.readAsDataURL(file);
    });

    // Update UI after adding files
    imagePreviewContainer.classList.remove('hidden');
    processButton.disabled = false;
    resetButton.classList.remove('hidden');
}


// --- UI Helper Functions ---

function resetApp() {
    uploadedFiles = [];
    imageUpload.value = ''; // Allows re-selecting the same file(s)
    imagePreviewGrid.innerHTML = '';
    imagePreviewContainer.classList.add('hidden');
    resultList.innerHTML = '';
    resultContainer.classList.add('hidden');
    errorMessage.classList.add('hidden');
    processButton.disabled = true;
    resetButton.classList.add('hidden');
}


function setLoadingState(isLoading: boolean) {
    if (isLoading) {
        loader.classList.remove('hidden');
        processButton.disabled = true;
        resetButton.disabled = true;
        processButton.textContent = 'Memproses...';
        resultContainer.classList.add('hidden');
        errorMessage.classList.add('hidden');
    } else {
        loader.classList.add('hidden');
        processButton.disabled = false;
        resetButton.disabled = false;
        processButton.textContent = 'GASKEN';
    }
}

function showError(message: string) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
    resultContainer.classList.add('hidden');
}

function displayResults(results: KtpData[]) {
    resultList.innerHTML = ''; // Clear previous results
    results.forEach((ktpData) => {
        const formattedParagraph = formatParagraph(ktpData);
        const resultElement = document.createElement('div');
        resultElement.className = 'bg-white/90 p-6 rounded-xl shadow-md relative transition-all hover:shadow-lg hover:scale-[1.02]';
        resultElement.innerHTML = `
            <p class="text-slate-700 leading-relaxed pr-24">${formattedParagraph}</p>
            <button class="copy-button absolute top-4 right-4 bg-indigo-100 text-indigo-700 font-semibold py-2 px-3 rounded-lg text-sm transition-all duration-300 flex items-center justify-center hover:bg-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-400" aria-label="Salin teks">
                <svg class="w-4 h-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a2.25 2.25 0 01-2.25 2.25h-1.5a2.25 2.25 0 01-2.25-2.25v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></svg>
                Salin
            </button>
        `;
        resultList.appendChild(resultElement);
    });

    if (results.length > 0) {
        resultContainer.classList.remove('hidden');
        errorMessage.classList.add('hidden');
    }
}

// Helper to create a FileList from an array of Files (for paste)
function createFileList(files: File[]): FileList {
    const dataTransfer = new DataTransfer();
    files.forEach(file => dataTransfer.items.add(file));
    return dataTransfer.files;
}


// --- Formatting Logic ---

function numberToWords(num: number): string {
    const units = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan'];
    const teens = ['sepuluh', 'sebelas', 'dua belas', 'tiga belas', 'empat belas', 'lima belas', 'enam belas', 'tujuh belas', 'delapan belas', 'sembilan belas'];
    const tens = ['', '', 'dua puluh', 'tiga puluh', 'empat puluh', 'lima puluh', 'enam puluh', 'tujuh puluh', 'delapan puluh', 'sembilan puluh'];

    if (num === 0) return 'nol';
    let words = '';
    if (Math.floor(num / 1000) > 0) {
        words += (Math.floor(num / 1000) === 1 ? 'seribu' : numberToWords(Math.floor(num / 1000)) + ' ribu') + ' ';
        num %= 1000;
    }
    if (Math.floor(num / 100) > 0) {
        words += (Math.floor(num / 100) === 1 ? 'seratus' : units[Math.floor(num / 100)] + ' ratus') + ' ';
        num %= 100;
    }
    if (num > 0) {
        if (num < 10) words += units[num];
        else if (num < 20) words += teens[num - 10];
        else words += tens[Math.floor(num / 10)] + (num % 10 > 0 ? ' ' + units[num % 10] : '');
    }
    return words.trim();
}

function dateToWords(dateStr: string): string {
    const months = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    try {
        const [day, month, year] = dateStr.split('-').map(Number);
        let yearInWords = numberToWords(year);
        if (year >= 2000) {
            yearInWords = `tahun ${yearInWords}`;
        }
        return `${numberToWords(day)} ${months[month]} ${yearInWords}`;
    } catch (e) {
        return "";
    }
}

function toTitleCase(str: string): string {
    if (!str) return '';
    return str.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
}


function formatParagraph(data: KtpData): string {
    if (!data.nik) return "Data tidak lengkap dari salah satu KTP. Pratinjau gambar mungkin tidak jelas.";

    let salutation = '';
    const gender = data.jenisKelamin.toUpperCase();
    const maritalStatus = data.statusPerkawinan.toUpperCase();

    if (gender.includes('LAKI')) {
        salutation = 'Tuan';
    } else {
        salutation = maritalStatus === 'BELUM KAWIN' ? 'Nona' : 'Nyonya';
    }

    let formattedName = '';
    let gelarDepan = (data.gelarDepanExpanded || '').trim();

    // Special handling for H./Haji -> Hajjah for females
    if (gelarDepan.toLowerCase().includes('haji') && gender.includes('PEREMPUAN')) {
        // Use regex for case-insensitive replacement
        gelarDepan = gelarDepan.replace(/haji/ig, 'Hajjah');
    }

    if (gelarDepan) {
        // Format the expanded title to Title Case (e.g., "Profesor Doktor")
        formattedName += `${toTitleCase(gelarDepan)} `;
    }
    
    formattedName += data.nama.toUpperCase();

    if (data.gelarBelakangExpanded) {
        formattedName += `, ${toTitleCase(data.gelarBelakangExpanded)}`;
    }
    
    const dateInWords = dateToWords(data.tanggalLahir);
    const rt = data.rt.padStart(3, '0');
    const rw = data.rw.padStart(3, '0');
    let citizenship = data.kewarganegaraan;
    if (citizenship.toUpperCase().trim() === 'WNI') {
        citizenship = 'Warga Negara Indonesia';
    }
    
    const tempatLahir = toTitleCase(data.tempatLahir);
    const pekerjaan = toTitleCase(data.pekerjaan);
    const kota = toTitleCase(data.kota);
    const alamat = data.alamat; // AI is expected to expand this now
    const kelDesa = toTitleCase(data.kelDesa);
    const kecamatan = toTitleCase(data.kecamatan);

    const fullAddress = `bertempat tinggal di ${kota}, ${alamat}, Rukun Tetangga ${rt}, Rukun Warga ${rw}, Kelurahan ${kelDesa}, Kecamatan ${kecamatan}`;
    
    return `<strong>${salutation} ${formattedName}</strong>, dilahirkan di ${tempatLahir}, tanggal ${data.tanggalLahir} (${dateInWords}), ${pekerjaan}, ${fullAddress}, pemegang Kartu Tanda Penduduk dengan Nomor Induk Kependudukan ${data.nik}, ${citizenship}.`;
}
