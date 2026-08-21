import { useParams } from 'wouter';
import { useGetCase, useGetLatestAnalysis, getGetLatestAnalysisQueryKey } from '@workspace/api-client-react';
import CaseHeader from './components/CaseHeader';
import IntakeSection from './components/IntakeSection';
import EvidencePack from './components/EvidencePack';

export default function CaseWorkspace() {
  const params = useParams();
  const caseId = Number(params.id);
  
  const { data: caseData, isLoading: caseLoading, error: caseError, refetch: refetchCase } = useGetCase(caseId);
  const { data: latestAnalysis, refetch: refetchLatest } = useGetLatestAnalysis(caseId, {
    query: { queryKey: getGetLatestAnalysisQueryKey(caseId) },
  });

  if (caseLoading) {
    return (
      <div className="p-8 space-y-6 animate-pulse">
        <div className="h-32 bg-card border border-border rounded-sm w-full"></div>
        <div className="h-48 bg-card border border-border rounded-sm w-full"></div>
        <div className="h-[500px] bg-card border border-border rounded-sm w-full"></div>
      </div>
    );
  }

  if (caseError || !caseData) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-center text-muted-foreground">
          <h2 className="text-lg font-medium text-foreground mb-2">Case Not Found</h2>
          <p>The requested investigation does not exist or has been deleted.</p>
        </div>
      </div>
    );
  }

  const handleRefetchData = () => {
    refetchCase();
    refetchLatest();
  };

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-[1600px] mx-auto">
      {/* 1. Profile Header */}
      <CaseHeader
        caseData={caseData}
        prediction={latestAnalysis?.profilePrediction ?? null}
        onProfileUpdated={handleRefetchData}
      />
      
      {/* 2. Intake & Files */}
      <IntakeSection 
        caseId={caseId} 
        caseData={caseData} 
        refetchCase={handleRefetchData} 
      />
      
      {/* 3. Evidence Pack (Outputs) */}
      <div className="pt-4 border-t border-border/50">
        <h2 className="text-xl font-semibold tracking-tight mb-6">Evidence Pack</h2>
        <EvidencePack caseId={caseId} />
      </div>
    </div>
  );
}