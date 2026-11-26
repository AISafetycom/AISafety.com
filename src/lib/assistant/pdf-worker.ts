// The background thread that reads PDFs for the chatbot's document upload
// (extract-document.ts starts it). It is PDF.js's own worker and nothing
// else; importing it from a file of ours lets the bundler package it.
import 'pdfjs-dist/legacy/build/pdf.worker.mjs'
