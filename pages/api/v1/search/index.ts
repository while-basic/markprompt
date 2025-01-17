import { createClient } from '@supabase/supabase-js';
import { Document } from 'flexsearch';
import { NextApiRequest, NextApiResponse } from 'next';

import { track } from '@/lib/posthog';
import { isSKTestKey, safeParseNumber } from '@/lib/utils';
import { Database, Json } from '@/types/supabase';
import { Project, SourceType } from '@/types/types';

const MAX_SEARCH_RESULTS = 20;

// Admin access to Supabase, bypassing RLS.
const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
);

type FileSectionContentInfo = {
  file_id: string;
  file_path: string;
  file_meta?: {
    title?: string;
  };
  section_content: string;
  section_meta?: {
    leadHeading?: {
      depth?: number;
      value: string;
    };
  };
  source_type: SourceType;
  source_data: any;
};

type Data =
  | {
      status?: string;
      error?: string;
    }
  | { data: FileSectionContentInfo[] };

const allowedMethods = ['GET'];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>,
) {
  // Preflight check
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200 });
  }

  if (!req.method || !allowedMethods.includes(req.method)) {
    res.setHeader('Allow', allowedMethods);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const params = req.body;
  const projectId = req.query.project as Project['id'];
  let config = {};
  try {
    config = JSON.parse((params.config || '') as string);
  } catch {
    // Do nothing
  }

  // if (!projectId) {
  //   console.error(`[INDEXES] Project not found`);
  //   return res.status(400).json({ error: 'Project not found' });
  // }

  // Apply rate limits, in additional to middleware rate limits.
  // const rateLimitResult = await checkSearchRateLimits({
  //   value: projectId,
  //   type: 'projectId',
  // });

  // TODO
  // if (!isRequestFromMarkprompt(req.headers.origin)) {
  //   // Search is part of the Enterprise plans when used outside of
  //   // the Markprompt dashboard.
  //   const teamStripeInfo = await getTeamStripeInfo(supabaseAdmin, projectId);
  //   if (
  //     !teamStripeInfo ||
  //     !isAtLeastPro(
  //       teamStripeInfo.stripePriceId,
  //       teamStripeInfo.isEnterprisePlan,
  //     )
  //   ) {
  //     return res.status(401).json({
  //       error: `The search endpoint is only accessible on the Pro and Enterprise plans. Please contact ${process.env.NEXT_PUBLIC_SALES_EMAIL} to get set up.`,
  //     });
  //   }
  // }

  const query = req.query.query as string;
  const limit = Math.min(
    MAX_SEARCH_RESULTS,
    safeParseNumber(req.query.limit as string, 10),
  );

  if (!query || query.trim() === '') {
    return res.status(200).json({
      data: [],
    });
  }

  const token: string | undefined = req.query.token as string;
  let publicApiKey: string | undefined = undefined;
  let privateDevApiKey: string | undefined = undefined;
  if (isSKTestKey(req.query.projectKey as string)) {
    privateDevApiKey = req.query.projectKey as string;
  } else {
    publicApiKey = req.query.projectKey as string;
  }

  const {
    data: _data,
    error,
  }: {
    data: FileSectionContentInfo[] | null | any;
    error: { message: string; code: string } | null;
  } = await supabaseAdmin.rpc('full_text_search', {
    search_text: query,
    match_count: limit,
    token,
    public_api_key: publicApiKey,
    private_dev_api_key: privateDevApiKey,
  });

  track(projectId, 'search', { projectId });

  if (error || !_data) {
    return res
      .status(400)
      .json({ error: error?.message || 'Error retrieving sections' });
  }

  const data = _data as FileSectionContentInfo[];

  const resultsByFile: { [key: string]: FileSectionContentInfo } = data.reduce(
    (acc: any, value: any) => {
      const {
        file_id,
        file_path,
        file_meta,
        section_content,
        section_meta,
        source_type,
        source_data,
      } = value;
      return {
        ...acc,
        [file_id]: {
          path: file_path,
          meta: file_meta,
          source: {
            type: source_type,
            ...(source_data ? { data: source_data } : {}),
          },
          sections: [
            ...(acc[file_id]?.sections || []),
            {
              ...(section_meta ? { meta: section_meta } : {}),
              content: (section_content || '').trim(),
            },
          ],
        },
      };
    },
    {} as any,
  );

  return res.status(200).json({
    data: Object.values(resultsByFile),
  });
}
