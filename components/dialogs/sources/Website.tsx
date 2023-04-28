import { track } from '@vercel/analytics';
import {
  ErrorMessage,
  Field,
  Form,
  Formik,
  FormikErrors,
  FormikValues,
} from 'formik';
import { ChangeEvent, FC, useState } from 'react';
import { toast } from 'react-hot-toast';

import Button from '@/components/ui/Button';
import { ErrorLabel } from '@/components/ui/Forms';
import { NoAutoInput } from '@/components/ui/Input';
import { Note } from '@/components/ui/Note';
import { addSource, deleteSource } from '@/lib/api';
import useProject from '@/lib/hooks/use-project';
import useSources from '@/lib/hooks/use-sources';
import useUser from '@/lib/hooks/use-user';
import { isWebsiteAccessible } from '@/lib/integrations/website';
import { getLabelForSource, toNormalizedHostname } from '@/lib/utils';
import { Project } from '@/types/types';

const _addSource = async (
  projectId: Project['id'],
  url: string,
  mutate: () => void,
) => {
  try {
    const newSource = await addSource(projectId, 'website', {
      url,
    });
    await mutate();
    toast.success(
      `The source ${getLabelForSource(
        newSource,
      )} has been added to the project.`,
    );
  } catch (e) {
    console.error(e);
    toast.error(`${e}`);
  }
};

type WebsiteSourceProps = {
  clearPrevious?: boolean;
  onDidRequestClose: () => void;
};

const WebsiteSource: FC<WebsiteSourceProps> = ({
  clearPrevious,
  onDidRequestClose,
}) => {
  const { project } = useProject();
  const { user } = useUser();
  const { sources, mutate } = useSources();
  const [website, setWebsite] = useState('');

  if (!user) {
    return <></>;
  }

  return (
    <>
      <Formik
        initialValues={{ website: '' }}
        validateOnBlur
        onSubmit={async (_values, { setSubmitting, setErrors }) => {
          if (!project || !website) {
            return;
          }

          let hostname = toNormalizedHostname(website);

          let isAccessible = await isWebsiteAccessible(hostname);
          if (!isAccessible) {
            hostname = toNormalizedHostname(website, true);
            isAccessible = await isWebsiteAccessible(hostname);
          }

          if (!isAccessible) {
            const errors: FormikErrors<FormikValues> = {
              website: 'Website is not accessible',
            };
            setErrors(errors);
            return;
          }

          setSubmitting(true);
          if (clearPrevious) {
            for (const source of sources) {
              await deleteSource(project.id, source.id);
            }
          }
          track('connect website');
          await _addSource(project.id, hostname, mutate);
          setSubmitting(false);
          onDidRequestClose();
        }}
      >
        {({ isSubmitting, isValid }) => (
          <Form className="h-full flex-grow">
            <div className="flex h-full flex-grow flex-col gap-2">
              <div className="h-flex-none mt-4 flex flex-col gap-1 px-4 pb-8">
                <p className="mb-1 flex-none text-sm font-medium text-neutral-300">
                  Website URL
                </p>
                <div className="flex flex-none flex-row gap-2">
                  <Field
                    className="flex-grow"
                    type="text"
                    name="website"
                    placeholder="example.com"
                    inputSize="sm"
                    as={NoAutoInput}
                    disabled={isSubmitting}
                    value={website}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                      setWebsite(event.target.value);
                    }}
                  />
                  <Button
                    className="flex-none"
                    disabled={!isValid}
                    loading={isSubmitting}
                    variant="plain"
                    buttonSize="sm"
                    type="submit"
                  >
                    Connect
                  </Button>
                </div>
                <ErrorMessage name="website" component={ErrorLabel} />
                <Note size="sm" className="mt-4" type="warning">
                  Make sure the website allows you to index its content. Please
                  do not build on top of other people&apos;s work unless you
                  have explicit authorization to do so.
                </Note>
              </div>
            </div>
          </Form>
        )}
      </Formik>
    </>
  );
};

export default WebsiteSource;