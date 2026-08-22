import React, { createContext, useContext, useCallback, useMemo, ReactNode } from 'react';
import { JobEntry } from '../types';
import { apiService } from '../services/api';
import { useCrudResource, CrudApi } from '../hooks/useCrudResource';
import logger from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

type JobEntryCreate = Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>;

interface JobContextType {
  jobEntries: JobEntry[];
  setJobEntries: React.Dispatch<React.SetStateAction<JobEntry[]>>;
  addJobEntry: (jobEntry: JobEntryCreate) => Promise<JobEntry>;
  updateJobEntry: (id: string, jobEntry: Partial<JobEntry>) => Promise<void>;
  deleteJobEntry: (id: string) => Promise<void>;
  refreshJobEntries: () => Promise<void>;
  addJobSignature: (id: string, signatureData: string, customerName: string) => Promise<void>;
  getJobEntryById: (id: string) => JobEntry | undefined;
}

// ============================================================================
// API-Bindung (Modulebene — stabile Identität für useCrudResource)
// ============================================================================

const jobApi: CrudApi<JobEntry, JobEntryCreate> = {
  list: () => apiService.getJobEntries(),
  create: (data) => apiService.createJobEntry(data),
  update: (id, data) => apiService.updateJobEntry(id, data),
  remove: (id) => apiService.deleteJobEntry(id),
};

// ============================================================================
// Context
// ============================================================================

const JobContext = createContext<JobContextType | undefined>(undefined);

// ============================================================================
// Provider
// ============================================================================

interface JobProviderProps {
  children: ReactNode;
  initialJobEntries?: JobEntry[];
}

export function JobProvider({ children, initialJobEntries = [] }: JobProviderProps) {
  const resource = useCrudResource<JobEntry, JobEntryCreate>('job entry', jobApi, initialJobEntries);
  const { setItems: setJobEntries } = resource;

  const addJobSignature = useCallback(async (id: string, signatureData: string, customerName: string): Promise<void> => {
    try {
      const response = await apiService.addJobSignature(id, signatureData, customerName);
      setJobEntries(prev => prev.map(job =>
        job.id === id ? response.job : job
      ));
    } catch (error) {
      logger.error('Error adding job signature', { error });
      throw error;
    }
  }, [setJobEntries]);

  const value: JobContextType = useMemo(() => ({
    jobEntries: resource.items,
    setJobEntries: resource.setItems,
    addJobEntry: resource.add,
    updateJobEntry: resource.update,
    deleteJobEntry: resource.remove,
    refreshJobEntries: resource.refresh,
    addJobSignature,
    getJobEntryById: resource.getById,
  }), [resource, addJobSignature]);

  return (
    <JobContext.Provider value={value}>
      {children}
    </JobContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useJobs(): JobContextType {
  const context = useContext(JobContext);
  if (context === undefined) {
    throw new Error('useJobs must be used within a JobProvider');
  }
  return context;
}
