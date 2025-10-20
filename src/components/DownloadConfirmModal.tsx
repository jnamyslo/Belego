import React from 'react';
import { X, Download, AlertCircle } from 'lucide-react';
import { Invoice } from '../types';

interface DownloadConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (markAsSent: boolean) => void;
  invoice: Invoice;
  format: 'standard' | 'zugferd' | 'xrechnung';
}

export function DownloadConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  invoice,
  format
}: DownloadConfirmModalProps) {
  if (!isOpen) return null;

  const formatLabels = {
    standard: 'Standard PDF',
    zugferd: 'ZUGFeRD',
    xrechnung: 'XRechnung (XML)'
  };

  const isDraft = invoice.status === 'draft';

  const handleConfirm = (markAsSent: boolean) => {
    onConfirm(markAsSent);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-full bg-primary-custom/10">
              <Download className="h-6 w-6 text-primary-custom" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Download bestätigen</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <div className="p-6">
          <div className="mb-4">
            <div className="bg-primary-custom/10 border border-primary-custom/30 rounded-lg p-4 mb-4">
              <h4 className="text-sm font-semibold text-primary-custom mb-2">
                📄 Download Details
              </h4>
              <p className="text-sm text-primary-custom">
                <strong>Rechnung:</strong> {invoice.invoiceNumber}<br/>
                <strong>Format:</strong> {formatLabels[format]}<br/>
                <strong>Status:</strong> {invoice.status === 'draft' ? 'Entwurf' : 
                                       invoice.status === 'sent' ? 'Versendet' :
                                       invoice.status === 'paid' ? 'Bezahlt' : 
                                       invoice.status === 'overdue' ? 'Überfällig' : invoice.status}
              </p>
            </div>
            
            {isDraft && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
                <div className="flex items-start space-x-3">
                  <AlertCircle className="h-5 w-5 text-orange-600 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-semibold text-orange-900 mb-2">
                      Entwurf-Status erkannt
                    </h4>
                    <p className="text-sm text-orange-800">
                      Diese Rechnung befindet sich noch im Entwurf-Status. Möchten Sie sie beim Download 
                      automatisch als "Versendet" markieren?
                    </p>
                  </div>
                </div>
              </div>
            )}
            
            <p className="text-sm text-gray-600 mb-4">
              {isDraft 
                ? 'Sie können wählen, ob die Rechnung als versendet markiert werden soll oder im Entwurf-Status bleibt.'
                : 'Die Rechnung wird heruntergeladen, ohne den Status zu ändern.'
              }
            </p>
          </div>
        </div>
        
        <div className="flex justify-end space-x-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Abbrechen
          </button>
          
          {isDraft ? (
            <>
              <button
                onClick={() => handleConfirm(false)}
                className="px-4 py-2 border border-primary-custom text-primary-custom rounded-lg hover:bg-primary-custom/10 transition-colors"
              >
                Download (Entwurf behalten)
              </button>
              <button
                onClick={() => handleConfirm(true)}
                className="px-4 py-2 btn-primary rounded-lg transition-colors flex items-center space-x-2"
              >
                <Download className="h-4 w-4" />
                <span>Download & als versendet markieren</span>
              </button>
            </>
          ) : (
            <button
              onClick={() => handleConfirm(false)}
              className="px-4 py-2 btn-primary rounded-lg transition-colors flex items-center space-x-2"
            >
              <Download className="h-4 w-4" />
              <span>Download</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
